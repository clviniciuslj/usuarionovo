import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, remove, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config-usuario.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const CONFIG_QUADRAS_PADRAO = {
  1: { ativa: true, nome: "Quadra 1" },
  2: { ativa: true, nome: "Quadra 2" },
  3: { ativa: true, nome: "Quadra 3" },
  4: { ativa: false, nome: "Quadra 4" },
  5: { ativa: false, nome: "Quadra 5" }
};

let fila = [], filaKeys = [], quadras = [];
let configQuadras = {};
let whatsappAvisoAtivo = true, inscricoesOnlineAtivas = true;
let meuUid = null;
let editandoId = null;
let posicoesAnteriores = new Map();
let ultimaMinhaPosicao = null;
let filaJaCarregouUmaVez = false;
let inscricaoPendenteWhatsapp = null;
let tipoSelecionado = "45";

// ---------- Helpers ----------

function formatarTimer(s) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }
function formatarHora(d) { return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function formatarChegada(d) { return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function formatarTempoRelativo(minutos) {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  if (total <= 0) return "agora";
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
function escaparHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function maskQL(v) {
  const n = v.replace(/\D/g, "").slice(0, 4);
  return n.length <= 2 ? n : `${n.slice(0, 2)}/${n.slice(2)}`;
}
function normalizarWhatsapp(v) {
  let n = String(v || "").replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return n;
}
function abreviarNome(nome) {
  const partes = String(nome || "").trim().split(/\s+/);
  if (partes.length <= 1) return partes[0] || "";
  return partes[0] + " " + partes[1][0].toUpperCase() + ".";
}
function formatarNomesAbreviados(jogadores = []) {
  return (jogadores || []).filter(Boolean).map((n) => escaparHtml(abreviarNome(n))).join(" • ");
}
function formatarNomesPareados(jogadores = []) {
  const nomes = (jogadores || []).filter(Boolean).map((n) => escaparHtml(n));
  if (nomes.length === 0) return "";
  const linhas = [];
  for (let i = 0; i < nomes.length; i += 2) linhas.push(nomes.slice(i, i + 2).join(" • "));
  return linhas.map((l) => `<div class="nomes-linha">${l}</div>`).join("");
}
function gerarChaveJogo(jogadores, qls) {
  const pares = [];
  for (let i = 0; i < jogadores.length; i++) {
    if (jogadores[i] && qls[i]) pares.push(`${jogadores[i].toLowerCase().trim()}|${qls[i].toLowerCase().trim()}`);
  }
  return pares.sort().join("||");
}

document.addEventListener("input", (e) => {
  if (e.target.classList?.contains("p-ql")) e.target.value = maskQL(e.target.value);
});

// ---------- Snackbar ----------

function mostrarSnackbar(texto, tipo = "info") {
  const root = document.getElementById("snackbarRoot");
  const item = document.createElement("div");
  item.className = `snackbar ${tipo}`;
  item.textContent = texto;
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => { item.classList.remove("show"); setTimeout(() => item.remove(), 250); }, 3200);
}

// ---------- Ripple feedback ----------

document.addEventListener("pointerdown", (e) => {
  const alvo = e.target.closest(".btn, .icon-btn");
  if (!alvo) return;
  const rect = alvo.getBoundingClientRect();
  const tamanho = Math.max(rect.width, rect.height) * 1.4;
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${tamanho}px`;
  ripple.style.left = `${e.clientX - rect.left - tamanho / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - tamanho / 2}px`;
  alvo.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
});

// ---------- Theme ----------

document.getElementById("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const icon = document.querySelector("#themeToggle i");
  icon.classList.add("icon-swap");
  setTimeout(() => {
    icon.className = document.body.classList.contains("dark") ? "ri-sun-line icon-swap" : "ri-moon-line icon-swap";
    requestAnimationFrame(() => icon.classList.remove("icon-swap"));
  }, 110);
  localStorage.setItem("tema", document.body.classList.contains("dark") ? "dark" : "light");
});
if (localStorage.getItem("tema") === "dark") document.body.classList.add("dark");

// ---------- Regulamento / termos ----------

const VERSAO_REGULAMENTO = "v5";
if (localStorage.getItem("regulamentoVersao") !== VERSAO_REGULAMENTO) {
  localStorage.removeItem("regulamentoAceito");
  localStorage.setItem("regulamentoVersao", VERSAO_REGULAMENTO);
}

function abrirModal(id) { document.getElementById(id).classList.add("show"); }
function fecharModal(id) { document.getElementById(id).classList.remove("show"); }

if (localStorage.getItem("regulamentoAceito") !== "true") {
  abrirModal("modalRegulamento");
}

document.getElementById("aceiteCheckbox").addEventListener("change", (e) => {
  document.getElementById("btnAceitarRegulamento").disabled = !e.target.checked;
});
document.getElementById("btnAceitarRegulamento").addEventListener("click", () => {
  if (!document.getElementById("aceiteCheckbox").checked) return;
  localStorage.setItem("regulamentoAceito", "true");
  fecharModal("modalRegulamento");
});
document.getElementById("btnAbrirTermos").addEventListener("click", () => abrirModal("modalTermos"));
document.getElementById("btnAbrirRegulamentoCompleto").addEventListener("click", () => abrirModal("modalRegulamentoCompleto"));
document.getElementById("btnFecharRegulamentoCompleto").addEventListener("click", () => fecharModal("modalRegulamentoCompleto"));
document.getElementById("btnAbrirTermosFooter").addEventListener("click", () => abrirModal("modalTermos"));
document.getElementById("btnFecharTermos").addEventListener("click", () => fecharModal("modalTermos"));

// ---------- Confirm modal genérico ----------

function confirmarAcao(titulo, texto) {
  return new Promise((resolve) => {
    document.getElementById("confirmTitulo").textContent = titulo;
    document.getElementById("confirmTexto").textContent = texto;
    const btnOk = document.getElementById("confirmOk");
    const btnCancelar = document.getElementById("confirmCancelar");
    function fechar(v) {
      fecharModal("modalConfirmar");
      btnOk.onclick = null; btnCancelar.onclick = null;
      resolve(v);
    }
    btnOk.onclick = () => fechar(true);
    btnCancelar.onclick = () => fechar(false);
    abrirModal("modalConfirmar");
  });
}

// ---------- Autenticação anônima ----------

signInAnonymously(auth)
  .then((cred) => { meuUid = cred.user.uid; })
  .catch((err) => console.error("Erro autenticação:", err));

// ---------- Quadras helpers ----------

function montarConfigQuadras(valor) {
  const base = JSON.parse(JSON.stringify(CONFIG_QUADRAS_PADRAO));
  if (valor && typeof valor === "object") {
    Object.keys(valor).forEach((id) => {
      base[id] = { ...base[id], ...valor[id] };
      if (typeof base[id].ativa !== "boolean") base[id].ativa = Number(id) <= 3;
      if (!base[id].nome) base[id].nome = `Quadra ${id}`;
    });
  }
  return base;
}
function normalizarQuadras(lista) {
  const existentes = Array.isArray(lista) ? lista.filter(Boolean) : Object.values(lista || {}).filter(Boolean);
  const mapa = {};
  existentes.forEach((q) => { if (q && q.id) mapa[q.id] = q; });
  for (let id = 1; id <= 5; id++) {
    if (!mapa[id]) mapa[id] = { id, ocupada: false, rodando: false, pausada: false, tempoRestante: 0, jogo: null, hEntrada: "", hSaida: "", horaTerminoAbsoluta: 0 };
  }
  return Object.values(mapa).sort((a, b) => a.id - b.id);
}
function quadraAtiva(id) { return (configQuadras?.[id] || CONFIG_QUADRAS_PADRAO[id])?.ativa !== false; }
function getQuadrasAtivas() { return (quadras || []).filter((q) => q && quadraAtiva(q.id)); }
function getTempoQuadraParaPrevisao(q) {
  if (!q || !q.ocupada) return { id: q?.id || "-", tempoSeg: 0, incerta: false };
  if (q.rodando && !q.pausada) return { id: q.id, tempoSeg: Math.max(0, q.tempoRestante || 0), incerta: false };
  if (q.pausada) return { id: q.id, tempoSeg: Math.max(0, q.tempoRestante || 0), incerta: true };
  return { id: q.id, tempoSeg: Math.max(0, q.tempoRestante || ((q.jogo?.duracao || 45) * 60)), incerta: true };
}
function calcularProgresso(q) {
  const total = Math.max(1, (q?.jogo?.duracao || 45) * 60);
  const restante = Math.max(0, Number(q?.tempoRestante) || 0);
  return Math.max(0, Math.min(100, (restante / total) * 100));
}

// ---------- Inscrição: tipo de jogo ----------

document.getElementById("tipoJogoGroup").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-opt");
  if (!btn) return;
  tipoSelecionado = btn.dataset.valor;
  document.querySelectorAll("#tipoJogoGroup .segmented-opt").forEach((b) => b.classList.toggle("active", b === btn));
  document.getElementById("tipoJogoGroup").classList.toggle("second-active", tipoSelecionado === "60");
  document.getElementById("playersGrid").classList.toggle("is-duplas", tipoSelecionado === "60");
});

function resetarFormulario() {
  document.querySelectorAll("#playersGrid input").forEach((i) => { i.value = ""; i.classList.remove("error"); });
  tipoSelecionado = "45";
  document.querySelectorAll("#tipoJogoGroup .segmented-opt").forEach((b, idx) => b.classList.toggle("active", idx === 0));
  document.getElementById("tipoJogoGroup").classList.remove("second-active");
  document.getElementById("playersGrid").classList.remove("is-duplas");
}

function cancelarEdicao() {
  editandoId = null;
  document.getElementById("formTitle").innerHTML = '<i class="ri-edit-2-line"></i> Inscrever-se na fila';
  document.getElementById("btnSubmit").innerHTML = '<i class="ri-add-line"></i> Entrar na fila';
  document.getElementById("btnCancelarEdicao").style.display = "none";
  document.getElementById("alertaEdicao").style.display = "none";
  resetarFormulario();
}
document.getElementById("btnCancelarEdicao").addEventListener("click", cancelarEdicao);

window.editarMeuItem = function (id) {
  const item = fila.find((j) => j.id === id);
  if (!item) return;
  editandoId = id;
  [1, 2, 3, 4].forEach((i) => {
    document.getElementById(`j${i}_nome`).value = item.jogadores?.[i - 1] || "";
    document.getElementById(`j${i}_ql`).value = item.qls?.[i - 1] || "";
  });
  tipoSelecionado = String(item.duracao);
  document.querySelectorAll("#tipoJogoGroup .segmented-opt").forEach((b) => b.classList.toggle("active", b.dataset.valor === tipoSelecionado));
  document.getElementById("tipoJogoGroup").classList.toggle("second-active", tipoSelecionado === "60");
  document.getElementById("playersGrid").classList.toggle("is-duplas", tipoSelecionado === "60");
  document.getElementById("formTitle").innerHTML = '<i class="ri-edit-2-line"></i> Editando inscrição';
  document.getElementById("btnSubmit").innerHTML = '<i class="ri-save-line"></i> Salvar alterações';
  document.getElementById("btnCancelarEdicao").style.display = "block";
  document.getElementById("alertaEdicao").style.display = "block";
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth" });
};

window.removerMinhaInscricao = async function (id) {
  const ok = await confirmarAcao("Remover inscrição?", "Esta inscrição será retirada da fila. Você poderá se inscrever novamente se precisar.");
  if (!ok) return;
  const index = fila.findIndex((item) => item.id === id);
  if (index === -1 || !filaKeys[index]) return;
  const key = filaKeys[index];
  try {
    await Promise.allSettled([remove(ref(db, `fila/${key}`)), remove(ref(db, `filaContatos/${key}`))]);
    mostrarSnackbar("Inscrição removida.", "success");
    if (editandoId === id) cancelarEdicao();
  } catch (e) { mostrarSnackbar("Erro ao remover.", "danger"); }
};

// ---------- WhatsApp opcional ----------

function abrirPopupWhatsapp(dados) {
  inscricaoPendenteWhatsapp = dados;
  document.getElementById("wppEscolhaBox").style.display = "flex";
  document.getElementById("wppInputBox").style.display = "none";
  document.getElementById("wppNumero").value = "";
  document.getElementById("wppErro").classList.remove("show");
  abrirModal("modalWhatsapp");
}
document.getElementById("wppNao").addEventListener("click", () => finalizarComWhatsapp(false, ""));
document.getElementById("wppSim").addEventListener("click", () => {
  document.getElementById("wppEscolhaBox").style.display = "none";
  document.getElementById("wppInputBox").style.display = "block";
  setTimeout(() => document.getElementById("wppNumero").focus(), 80);
});
document.getElementById("wppConfirmar").addEventListener("click", () => {
  const numero = normalizarWhatsapp(document.getElementById("wppNumero").value);
  if (!(numero.length === 12 || numero.length === 13) || !numero.startsWith("55")) {
    document.getElementById("wppErro").classList.add("show");
    return;
  }
  finalizarComWhatsapp(true, numero);
});

function finalizarComWhatsapp(deseja, numero) {
  const dados = inscricaoPendenteWhatsapp;
  inscricaoPendenteWhatsapp = null;
  fecharModal("modalWhatsapp");
  if (!dados) return;
  criarNovaInscricao(dados.nomes, dados.qls, dados.duracao, { desejaWhatsapp: deseja, whatsapp: numero });
}

// ---------- Inscrever na fila ----------

document.getElementById("btnSubmit").addEventListener("click", () => {
  if (!inscricoesOnlineAtivas) { mostrarSnackbar("Inscrições online fechadas. Procure o fiscal.", "warning"); return; }
  if (!meuUid) { mostrarSnackbar("Aguarde a autenticação...", "warning"); return; }

  const isDupla = tipoSelecionado === "60";
  document.querySelectorAll("#playersGrid input").forEach((i) => i.classList.remove("error"));
  const nomes = [], qls = [];
  let temErro = false;
  for (let i = 1; i <= 4; i++) {
    const inputNome = document.getElementById(`j${i}_nome`);
    const inputQl = document.getElementById(`j${i}_ql`);
    const visivel = i <= 2 || isDupla;
    if (!visivel) continue;
    const obrigatorio = i <= 2 || (i === 3 && isDupla);
    if (obrigatorio && !inputNome.value.trim()) { inputNome.classList.add("error"); temErro = true; }
    if (inputNome.value.trim()) nomes.push(inputNome.value.trim());
    if (inputNome.value.trim() && !inputQl.value.trim()) { inputQl.classList.add("error"); temErro = true; }
    if (inputQl.value.trim()) qls.push(inputQl.value.trim());
  }
  if (temErro) {
    document.querySelector(".error")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const minimo = isDupla ? 3 : 2;
  if (nomes.length < minimo) { mostrarSnackbar(`Mínimo de ${minimo} jogadores para ${isDupla ? "Duplas" : "Simples"}!`, "danger"); return; }

  if (editandoId) {
    const idx = fila.findIndex((item) => item.id === editandoId);
    if (idx !== -1 && filaKeys[idx]) {
      const key = filaKeys[idx];
      Promise.allSettled([remove(ref(db, `fila/${key}`)), remove(ref(db, `filaContatos/${key}`))]).then(() => {
        editandoId = null;
        cancelarEdicao();
        iniciarFluxoInscricao({ nomes, qls, duracao: tipoSelecionado });
      });
      return;
    }
  }
  iniciarFluxoInscricao({ nomes, qls, duracao: tipoSelecionado });
});

function iniciarFluxoInscricao(dados) {
  if (whatsappAvisoAtivo) { abrirPopupWhatsapp(dados); return; }
  criarNovaInscricao(dados.nomes, dados.qls, dados.duracao, { desejaWhatsapp: false, whatsapp: "" });
}

function criarNovaInscricao(nomes, qls, duracao, avisoConfig) {
  const novaChave = gerarChaveJogo(nomes, qls);

  const estaJogando = quadras.some((q) => {
    if (!q.ocupada || !q.rodando || !q.jogo) return false;
    return gerarChaveJogo(q.jogo.jogadores || [], q.jogo.qls || []) === novaChave;
  });
  if (estaJogando) { mostrarSnackbar(`"${nomes.join(" e ")}" já estão jogando. Aguarde o término.`, "danger"); return; }

  const estaNaFila = fila.some((item) => gerarChaveJogo(item.jogadores || [], item.qls || []) === novaChave);
  if (estaNaFila) { mostrarSnackbar(`"${nomes.join(" e ")}" já estão na fila.`, "warning"); return; }

  const itemRef = push(ref(db, "fila"));
  const itemKey = itemRef.key;
  const agoraIso = new Date().toISOString();
  const novoJogo = {
    id: Date.now(),
    nomes: nomes.join(" • "),
    detalhes: qls.join(", "),
    duracao: parseInt(duracao),
    chegada: agoraIso,
    jogadores: nomes,
    qls,
    deviceId: meuUid,
    criadoPorUid: meuUid,
    origem: "usuario",
    desejaWhatsapp: !!avisoConfig.desejaWhatsapp
  };

  const atualizacoes = { [`fila/${itemKey}`]: novoJogo };
  if (avisoConfig.desejaWhatsapp) {
    atualizacoes[`filaContatos/${itemKey}`] = {
      whatsapp: normalizarWhatsapp(avisoConfig.whatsapp),
      criadoPorUid: meuUid,
      criadoEm: agoraIso,
      filaItemId: novoJogo.id
    };
  }

  update(ref(db), atualizacoes)
    .then(() => { mostrarSnackbar("Inscrição confirmada!", "success"); cancelarEdicao(); })
    .catch(() => mostrarSnackbar("Erro ao inscrever. Tente novamente.", "danger"));
}

// ---------- Render: quadras ----------

function renderQuadras() {
  const container = document.getElementById("courtsRow");
  const ativas = getQuadrasAtivas().filter(Boolean);
  if (!quadras || quadras.length === 0) {
    container.innerHTML = `<div class="court-skel"></div><div class="court-skel"></div><div class="court-skel"></div>`;
    return;
  }
  container.innerHTML = ativas.map((q) => {
    if (!q.ocupada) {
      return `<div class="court-card free">
        <div class="court-badge free">Q${q.id}</div>
        <i class="ri-tennis-ball-line court-free-icon"></i>
        <div class="court-players livre">Livre</div>
        <div class="court-free-msg">Disponível para próximo jogo</div>
      </div>`;
    }
    const restante = q.tempoRestante || 0;
    const pct = calcularProgresso(q) / 100;
    const circ = 2 * Math.PI * 30;
    const offset = circ * (1 - pct);
    const baixo = restante > 0 && restante <= 300 && !q.pausada;
    const fim   = restante <= 0;
    const ringClass = fim ? "ring-fill fim" : baixo ? "ring-fill baixo" : "ring-fill";
    const timerClass = fim ? "court-timer warning" : baixo ? "court-timer warning" : "court-timer";
    return `<div class="court-card ocupada">
      <div class="court-top">
        <div class="court-badge">Q${q.id}</div>
        <div>
          <div class="court-players">${formatarNomesAbreviados(q.jogo?.jogadores)}</div>
          <div class="court-meta">${q.rodando ? `Término ${q.hSaida || "--:--"}` : "Aguardando início"}</div>
        </div>
      </div>
      <div class="court-ring-wrap">
        <svg class="court-ring-svg" viewBox="0 0 72 72">
          <circle class="ring-bg" cx="36" cy="36" r="30"/>
          <circle id="ring-q${q.id}" class="${ringClass}" cx="36" cy="36" r="30" style="stroke-dashoffset:${offset.toFixed(1)}"/>
        </svg>
        <div id="timer-q${q.id}" class="${timerClass}">${formatarTimer(restante)}</div>
      </div>
    </div>`;
  }).join("");
}

function atualizarProgressoQuadra(q) {
  const ring  = document.getElementById(`ring-q${q.id}`);
  const timer = document.getElementById(`timer-q${q.id}`);
  if (!ring || !timer) return;
  const restante = Math.max(0, Number(q.tempoRestante) || 0);
  const pct    = calcularProgresso(q) / 100;
  const circ   = 2 * Math.PI * 30;
  ring.style.strokeDashoffset = (circ * (1 - pct)).toFixed(1);
  const baixo = restante > 0 && restante <= 300 && !q.pausada;
  const fim   = restante <= 0;
  ring.className  = fim ? "ring-fill fim" : baixo ? "ring-fill baixo" : "ring-fill";
  timer.className = (fim || baixo) ? "court-timer warning" : "court-timer";
  timer.textContent = formatarTimer(restante);
}

// ---------- Render: status "minha posição" ----------

function renderMeuStatus(minhaPosicao) {
  const el = document.getElementById("meuStatus");
  if (minhaPosicao === -1) { el.style.display = "none"; el.className = "status-card"; return; }
  el.style.display = "block";
  if (minhaPosicao === 0) {
    el.className = "status-card agora";
    el.innerHTML = `<strong>Você é o próximo da fila</strong><span>Fique por perto. Quando uma quadra liberar, a administração pode chamar sua inscrição.</span>`;
  } else {
    el.className = "status-card proximo";
    const faltam = minhaPosicao;
    el.innerHTML = `<strong>Você está em #${minhaPosicao + 1} na fila</strong><span>Faltam ${faltam} ${faltam === 1 ? "inscrição" : "inscrições"} antes de você.</span>`;
  }
}

// ---------- Render: fila ----------

function atualizarSombraFila() {
  const corpo = document.getElementById("queueList");
  if (!corpo) return;
  const temMais = corpo.scrollHeight > corpo.clientHeight + 4 && corpo.scrollTop + corpo.clientHeight < corpo.scrollHeight - 4;
  corpo.classList.toggle("has-more", temMais);
}
document.getElementById("queueList").addEventListener("scroll", () => atualizarSombraFila(), { passive: true });

function renderFila(animar = false) {
  const countEl = document.getElementById("filaCount");
  const corpo = document.getElementById("queueList");
  countEl.textContent = fila.length;

  const minhaPosicao = fila.findIndex((j) => meuUid && j.deviceId === meuUid);
  renderMeuStatus(minhaPosicao);

  if (filaJaCarregouUmaVez && minhaPosicao !== -1 && ultimaMinhaPosicao !== null && ultimaMinhaPosicao !== -1 && minhaPosicao < ultimaMinhaPosicao) {
    if (minhaPosicao === 0) mostrarSnackbar("A fila andou. Você agora é o próximo da fila.", "success");
    else mostrarSnackbar(`A fila andou. Você agora é o ${minhaPosicao + 1}º da fila.`, "info");
  }
  ultimaMinhaPosicao = minhaPosicao;

  if (fila.length === 0) {
    corpo.innerHTML = `<div class="empty-state-rich"><i class="ri-walk-line"></i><strong>A fila está livre</strong><span>Inscreva-se agora!</span></div>`;
    corpo.classList.remove("has-more");
    posicoesAnteriores = new Map();
    return;
  }

  let ts = getQuadrasAtivas().map((q) => getTempoQuadraParaPrevisao(q));
  const agora = Date.now();
  const html = [];

  fila.forEach((j, idx) => {
    let previsaoHtml;
    if (ts.length > 0) {
      ts.sort((a, b) => a.tempoSeg - b.tempoSeg);
      const qE = ts[0];
      const minutosPrevisao = Math.max(0, Math.round(qE.tempoSeg / 60));
      qE.tempoSeg += (j.duracao || 45) * 60;
      if (minutosPrevisao === 0) {
        previsaoHtml = `<span class="wait-est proximo">≈ próximo</span>`;
      } else if (minutosPrevisao < 60) {
        previsaoHtml = `<span class="wait-est">≈ ${minutosPrevisao} min</span>`;
      } else {
        const h = Math.floor(minutosPrevisao / 60);
        const m = minutosPrevisao % 60;
        previsaoHtml = `<span class="wait-est">≈ ${h}h${m > 0 ? ` ${m}min` : ""}</span>`;
      }
    } else {
      previsaoHtml = `<span class="wait-est">≈ disponível</span>`;
    }

    const ehMinha = meuUid && j.deviceId === meuUid;
    const tipoTexto = (j.duracao || 45) === 60 ? "Duplas" : "Simples";
    const chegada = j.chegada ? formatarChegada(j.chegada) : "--:--";
    const detalhes = (j.qls || []).filter(Boolean).join(", ") || j.detalhes || "Sem Q/L";

    const posicaoAtual = idx + 1;
    const posicaoAntiga = posicoesAnteriores.get(j.id);
    const posMudou = posicaoAntiga !== undefined && posicaoAntiga !== posicaoAtual;
    const posHtml = posMudou
      ? `<span class="queue-pos pos-anim"><span class="pos-old">#${posicaoAntiga}</span><span class="pos-new">#${posicaoAtual}</span></span>`
      : `<span class="queue-pos">#${posicaoAtual}</span>`;

    html.push(`<div class="queue-item ${ehMinha ? "minha" : ""}">
      <div class="queue-item-top">
        ${posHtml}
        <div class="queue-names">${formatarNomesAbreviados(j.jogadores)}</div>
        ${ehMinha ? '<span class="voce-tag">Você</span>' : ""}
        <span class="type-chip ${(j.duracao || 45) === 60 ? "dupla" : "simples"}">${tipoTexto}</span>
        ${previsaoHtml}
      </div>
      <div class="queue-meta">
        <span>${chegada}</span>
        ${ehMinha ? `<span class="dot"></span><span>${escaparHtml(detalhes)}</span>` : ""}
      </div>
      ${ehMinha ? `<div class="queue-actions-self">
        <button class="btn btn-outline" onclick="editarMeuItem(${j.id})"><i class="ri-edit-2-line"></i> Editar</button>
        <button class="btn btn-danger" onclick="removerMinhaInscricao(${j.id})"><i class="ri-close-line"></i> Remover</button>
      </div>` : ""}
    </div>`);
  });

  corpo.classList.toggle("queue-list-animate", animar);
  corpo.innerHTML = html.join("");
  posicoesAnteriores = new Map(fila.map((j, idx) => [j.id, idx + 1]));
  atualizarSombraFila();
}

// ---------- Inscrições online ----------

function atualizarControleInscricoes() {
  document.getElementById("formPanel").style.display = inscricoesOnlineAtivas ? "block" : "none";
  document.getElementById("inscricoesFechadas").style.display = inscricoesOnlineAtivas ? "none" : "block";
}

// ---------- Firebase listeners ----------

onValue(ref(db, "config/quadras"), (snapshot) => {
  configQuadras = montarConfigQuadras(snapshot.exists() ? snapshot.val() : CONFIG_QUADRAS_PADRAO);
  renderQuadras();
  renderFila();
});

onValue(ref(db, "config/whatsappAvisoAtivo"), (snapshot) => {
  whatsappAvisoAtivo = snapshot.exists() ? snapshot.val() !== false : true;
});

onValue(ref(db, "config/inscricoesOnlineAtivas"), (snapshot) => {
  inscricoesOnlineAtivas = snapshot.exists() ? snapshot.val() !== false : true;
  atualizarControleInscricoes();
});

onValue(ref(db, "fila"), (snapshot) => {
  const filaKeysAntes = filaKeys.slice();
  const d = snapshot.val();
  if (!d) { fila = []; filaKeys = []; }
  else {
    const entries = Object.entries(d);
    fila = entries.map(([, value]) => {
      const { whatsapp, telefone, celular, contato, ...publicos } = value || {};
      return publicos;
    });
    filaKeys = entries.map(([key]) => key);
  }
  const houveMudanca = filaJaCarregouUmaVez && (filaKeysAntes.length !== filaKeys.length || filaKeysAntes.some((k, i) => k !== filaKeys[i]));
  filaJaCarregouUmaVez = true;
  renderFila(houveMudanca);
});

onValue(ref(db, "quadras"), (snapshot) => {
  if (!snapshot.exists()) {
    quadras = normalizarQuadras([]);
    set(ref(db, "quadras"), quadras);
  } else {
    quadras = normalizarQuadras(snapshot.val());
  }
  renderQuadras();
  renderFila();
});

// ---------- Timer tick ----------

let ultimoMinutoFila = null;
setInterval(() => {
  const agora = Date.now();
  quadras.forEach((q) => {
    if (q && q.ocupada && q.rodando && !q.pausada && q.horaTerminoAbsoluta) {
      const r = Math.max(0, Math.ceil((q.horaTerminoAbsoluta - agora) / 1000));
      if (q.tempoRestante !== r) {
        q.tempoRestante = r;
        const el = document.getElementById(`timer-q${q.id}`);
        if (el) { el.textContent = formatarTimer(r); el.classList.toggle("warning", r > 0 && r < 60); }
        atualizarProgressoQuadra(q);
      }
    }
  });

  const minutoAtual = Math.floor(agora / 60000);
  if (minutoAtual !== ultimoMinutoFila) { ultimoMinutoFila = minutoAtual; renderFila(); }
}, 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("usuario-sw.js?v=1.0").catch(() => {}); });
}
