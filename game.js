const FACTIONS = {
  heart: { label: "红桃", symbol: "♥", className: "heart" },
  spade: { label: "黑桃", symbol: "♠", className: "spade" },
  joker: { label: "小丑", symbol: "J", className: "joker" },
};

const ROLE_LABELS = { king: "国王", queen: "王后", knight: "骑士" };
const rowLayouts = [
  [3],
  [2, 4],
  [1, 3, 5],
  [0, 2, 4, 6],
  [1, 3, 5],
  [0, 2, 4, 6],
  [1, 3, 5],
  [2, 4],
  [3],
];
const boardRows = rowLayouts.map((layout) => layout.map((_, col) => col));
const finalRow = boardRows.length - 1;
const goalTiles = {
  spade: new Set(["1-0", "2-0", "3-0"]),
  joker: new Set(["0-0"]),
  heart: new Set(["1-1", "2-2", "3-3"]),
};
const skillTiles = { "5-1": "交换", "5-2": "交换", "6-0": "查验", "6-2": "查验" };
const jokerArrowOverrides = {
  "4-0": "spade",
  "5-0": "heart",
  "5-2": "spade",
  "6-1": "heart",
};

const state = {
  round: 1,
  phase: "seatSelect",
  players: [],
  viewerId: null,
  visibleTeamIds: new Set(),
  flashingTeamIds: new Set(),
  bigKnownInfectedIds: new Set(),
  bombQueenSelectors: new Set(),
  bombExploded: false,
  identityTimers: [],
  aiTimer: null,
  talkTimer: null,
  courtTimer: null,
  flashingCourtIds: new Set(),
  selectedPlayers: new Set(),
  roles: { king: null, queen: null, knight: null },
  offers: { king: [], queen: [] },
  choices: { king: null, queen: null, knight: null },
  previousCourt: new Set(),
  position: { row: finalRow, col: 0 },
  piecePixel: null,
  pendingLanding: null,
  pendingMoveFaction: null,
  tableTalk: [],
  visibleTalkCount: 0,
  currentSkill: null,
  midgameUnlocked: false,
  proposal: null,
  objections: new Set(),
  log: [],
};

const els = {
  setupScreen: document.querySelector("#setupScreen"),
  setupSeats: document.querySelector("#setupSeats"),
  identityModal: document.querySelector("#identityModal"),
  identityText: document.querySelector("#identityText"),
  identityCountdown: document.querySelector("#identityCountdown"),
  teammateHint: document.querySelector("#teammateHint"),
  gameShell: document.querySelector("#gameShell"),
  roundNo: document.querySelector("#roundNo"),
  phaseTitle: document.querySelector("#phaseTitle"),
  actionHeading: document.querySelector("#actionHeading"),
  playerList: document.querySelector("#playerList"),
  spadeIntel: document.querySelector("#spadeIntel"),
  jokerIntel: document.querySelector("#jokerIntel"),
  boardStage: document.querySelector("#boardStage"),
  hexBoard: document.querySelector("#hexBoard"),
  roleSummary: document.querySelector("#roleSummary"),
  actionArea: document.querySelector("#actionArea"),
  skillArea: document.querySelector("#skillArea"),
  logList: document.querySelector("#logList"),
  resetBtn: document.querySelector("#resetBtn"),
};

const BOARD_SIZE = { width: 840, height: 790 };

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function factionName(faction) {
  return FACTIONS[faction].label;
}

function identityLabel(player) {
  return player.jokerRank || factionName(player.faction);
}

function playerName(id) {
  return state.players.find((item) => item.id === id)?.name || "未选择";
}

function playerNameStack(id) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return `<span class="player-name stacked-player-name"><span>未选择</span></span>`;
  return `<span class="player-name stacked-player-name"><span>玩家</span><span>${player.id}号</span></span>`;
}

function playerNameStackList(ids) {
  return ids.length ? ids.map(playerNameStack).join("<span class=\"name-separator\">、</span>") : "无";
}

function playerFaction(id) {
  return state.players.find((item) => item.id === id)?.faction;
}

function playerIdentity(id) {
  const player = state.players.find((item) => item.id === id);
  return player ? { faction: player.faction, jokerRank: player.jokerRank } : null;
}

function applyIdentity(player, identity) {
  player.faction = identity.faction;
  player.jokerRank = identity.faction === "joker" ? identity.jokerRank || "小王" : "";
}

function activePlayers() {
  return state.players.filter((player) => !player.sacrificed);
}

function bigJoker() {
  return state.players.find((player) => player.faction === "joker" && player.jokerRank === "大王");
}

function bombJoker() {
  return state.players.find((player) => player.faction === "joker" && player.jokerRank === "王炸");
}

function jokerConversionCandidates() {
  const big = bigJoker();
  return activePlayers().filter((player) => player.id !== big?.id && player.faction !== "joker" && !player.inspected);
}

function nextClockwisePlayerId(fromId) {
  const active = activePlayers();
  if (!active.length) return null;
  const index = active.findIndex((player) => player.id === fromId);
  return active[index >= 0 ? (index + 1) % active.length : 0].id;
}

function resetProposal() {
  state.proposal = null;
  state.objections = new Set();
}

function clearAiTimer() {
  if (state.aiTimer) clearTimeout(state.aiTimer);
  state.aiTimer = null;
}

function clearTalkTimer() {
  if (state.talkTimer) clearTimeout(state.talkTimer);
  state.talkTimer = null;
}

function clearCourtTimer() {
  if (state.courtTimer) clearTimeout(state.courtTimer);
  state.courtTimer = null;
}

function rotateKing(reason = "棋子移动后") {
  const next = nextClockwisePlayerId(state.roles.king);
  state.roles = { king: next, queen: null, knight: null };
  state.selectedPlayers = new Set();
  state.offers = { king: [], queen: [] };
  state.choices = { king: null, queen: null, knight: null };
  addLog(`${reason}：国王按顺时针顺序交给 ${playerName(next)}。`);
  return next;
}

function createPlayers() {
  const identities = shuffle([
    "heart", "heart", "heart", "heart", "heart", "heart", "heart",
    "spade", "spade", "spade", "spade",
    "joker", "joker", "joker",
  ]);
  state.players = identities.map((faction, index) => ({
    id: index + 1,
    name: `玩家 ${index + 1}`,
    faction,
    jokerRank: faction === "joker" ? null : "",
    inspected: false,
    sacrificed: false,
    objectionVotes: 2,
  }));

  const jokers = state.players.filter((player) => player.faction === "joker");
  if (jokers[0]) jokers[0].jokerRank = "大王";
  if (jokers[1]) jokers[1].jokerRank = "小王";
  if (jokers[2]) jokers[2].jokerRank = "王炸";
}

function resetGame() {
  state.round = 1;
  state.phase = "seatSelect";
  state.viewerId = null;
  state.visibleTeamIds = new Set();
  state.flashingTeamIds = new Set();
  state.bigKnownInfectedIds = new Set();
  state.bombQueenSelectors = new Set();
  state.bombExploded = false;
  clearAiTimer();
  clearTalkTimer();
  clearCourtTimer();
  clearIdentityTimers();
  state.selectedPlayers = new Set();
  state.roles = { king: null, queen: null, knight: null };
  state.offers = { king: [], queen: [] };
  state.choices = { king: null, queen: null, knight: null };
  state.flashingCourtIds = new Set();
  state.previousCourt = new Set();
  state.position = { row: finalRow, col: 0 };
  state.piecePixel = null;
  state.pendingLanding = null;
  state.pendingMoveFaction = null;
  state.tableTalk = [];
  state.visibleTalkCount = 0;
  state.currentSkill = null;
  state.midgameUnlocked = false;
  resetProposal();
  state.log = [];
  createPlayers();
  addLog("新局开始：7 名红桃、4 名黑桃、3 名王牌（大王、小王、王炸）已随机发放。");
  showSetup();
}

function clearIdentityTimers() {
  state.identityTimers.forEach((timer) => clearTimeout(timer));
  state.identityTimers = [];
}

function showSetup() {
  els.gameShell.classList.add("game-hidden");
  els.setupScreen.classList.remove("hidden");
  els.identityModal.classList.add("hidden");
  renderSetupSeats();
}

function renderSetupSeats() {
  els.setupSeats.innerHTML = state.players
    .map((player) => `
      <button class="setup-seat ${state.visibleTeamIds.has(player.id) ? "team-known" : ""} ${state.flashingTeamIds.has(player.id) ? "team-flash" : ""}" data-setup-player="${player.id}" type="button">
        <strong>${playerNameStack(player.id)}</strong>
        <small>点击查看身份</small>
      </button>
    `)
    .join("");
  document.querySelectorAll("[data-setup-player]").forEach((button) => {
    button.addEventListener("click", () => chooseSeat(Number(button.dataset.setupPlayer)));
  });
}

function chooseSeat(id) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  clearIdentityTimers();
  state.viewerId = id;
  state.visibleTeamIds = new Set();
  state.flashingTeamIds = new Set();
  els.identityText.textContent = identityLabel(player);
  els.identityCountdown.textContent = "3 秒后收回";
  els.teammateHint.textContent = "";
  els.teammateHint.classList.remove("flashing");
  els.identityModal.classList.remove("hidden");

  const teammates = teammateIdsFor(player);
  if (teammates.length) {
    state.identityTimers.push(setTimeout(() => {
      state.visibleTeamIds = new Set(teammates);
      state.flashingTeamIds = new Set(teammates);
      els.teammateHint.innerHTML = `队友：${playerNameStackList(teammates)}`;
      els.teammateHint.classList.add("flashing");
      renderSetupSeats();
    }, 1000));
    state.identityTimers.push(setTimeout(() => {
      state.flashingTeamIds = new Set();
      els.teammateHint.classList.remove("flashing");
      renderSetupSeats();
    }, 3000));
  }

  state.identityTimers.push(setTimeout(() => {
    startGameAfterIdentity();
  }, 3000));
}

function teammateIdsFor(player) {
  if (player.faction === "spade") {
    return state.players.filter((item) => item.faction === "spade" && item.id !== player.id).map((item) => item.id);
  }
  if (player.faction === "joker" && player.jokerRank === "大王") return [];
  if (player.faction === "joker" && player.jokerRank === "小王") {
    const big = bigJoker();
    return big ? [big.id] : [];
  }
  return [];
}

function startGameAfterIdentity() {
  clearTalkTimer();
  els.identityModal.classList.add("hidden");
  els.setupScreen.classList.add("hidden");
  els.gameShell.classList.remove("game-hidden");
  state.flashingTeamIds = new Set();
  state.phase = "appointCourt";
  state.roles = { king: 1, queen: null, knight: null };
  state.selectedPlayers = new Set();
  addLog("游戏开始：玩家 1 先当国王，之后按编号顺序向后推进。");
  render();
}

function addLog(text) {
  state.log.unshift(text);
  state.log = state.log.slice(0, 26);
}

function logWithStackedNames(text) {
  return text.replace(/玩家\s*(\d+)/g, (_, id) => playerNameStack(Number(id)));
}

function drawCards() {
  const pool = ["heart", "spade", "joker"];
  return [pool[Math.floor(Math.random() * pool.length)], pool[Math.floor(Math.random() * pool.length)]];
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function isViewerTurn() {
  if (!state.viewerId) return false;
  if (state.phase === "discussion") return true;
  if (["appointCourt", "exchangeSkill", "inspectSkill", "reselectKnight"].includes(state.phase)) return state.roles.king === state.viewerId;
  if (state.phase === "kingChoice") return state.roles.king === state.viewerId;
  if (state.phase === "queenChoice") return state.roles.queen === state.viewerId;
  if (state.phase === "knightChoice") return state.roles.knight === state.viewerId;
  if (state.phase === "jokerConvert") return bigJoker()?.id === state.viewerId;
  if (state.phase === "decision") {
    const viewer = state.players.find((player) => player.id === state.viewerId);
    return Boolean(viewer && !viewer.sacrificed && viewer.id !== state.roles.king && viewer.objectionVotes > 0 && !state.objections.has(viewer.id));
  }
  return false;
}

function aiPickCourt() {
  const candidates = activePlayers().filter((player) => player.id !== state.roles.king && !state.previousCourt.has(player.id));
  state.selectedPlayers = new Set(shuffle(candidates).slice(0, 2).map((player) => player.id));
  confirmCourt();
}

function aiPickSkillTargets(count, excluded = new Set()) {
  return shuffle(activePlayers().filter((player) => !excluded.has(player.id))).slice(0, count).map((player) => player.id);
}

function aiAct() {
  state.aiTimer = null;
  if (canBombSelfDetonate() && state.viewerId !== bombJoker()?.id && state.bombQueenSelectors.size && Math.random() < 0.35) {
    selfDetonateBomb();
    return;
  }
  if (state.phase === "appointCourt" && state.roles.king !== state.viewerId) {
    aiPickCourt();
    return;
  }
  if (state.phase === "kingChoice" && state.roles.king !== state.viewerId) {
    chooseRoyalCard("king", randomItem(state.offers.king));
    return;
  }
  if (state.phase === "queenChoice" && state.roles.queen !== state.viewerId) {
    chooseRoyalCard("queen", randomItem(state.offers.queen));
    return;
  }
  if (state.phase === "knightChoice" && state.roles.knight !== state.viewerId) {
    if (state.midgameUnlocked && Math.random() < 0.12) {
      sacrificeKnight();
      return;
    }
    chooseKnightCard(randomItem([state.choices.king, state.choices.queen]));
    return;
  }
  if (state.phase === "exchangeSkill" && state.roles.king !== state.viewerId) {
    state.selectedPlayers = new Set(aiPickSkillTargets(3));
    proposeExchange();
    return;
  }
  if (state.phase === "inspectSkill" && state.roles.king !== state.viewerId) {
    state.selectedPlayers = new Set(aiPickSkillTargets(1));
    proposeInspect();
    return;
  }
  if (state.phase === "jokerConvert" && bigJoker()?.id !== state.viewerId) {
    const target = randomItem(jokerConversionCandidates());
    if (target) {
      state.selectedPlayers = new Set([target.id]);
      confirmJokerConversion();
    }
    return;
  }
  if (state.phase === "reselectKnight" && state.roles.king !== state.viewerId) {
    const candidates = activePlayers().filter((player) => player.id !== state.roles.king && player.id !== state.roles.queen);
    const target = randomItem(candidates);
    if (target) {
      state.selectedPlayers = new Set([target.id]);
      confirmNewKnight();
    }
    return;
  }
  if (state.phase === "decision") {
    const aiVoters = activePlayers().filter((player) => (
      player.id !== state.viewerId &&
      player.id !== state.roles.king &&
      player.objectionVotes > 0 &&
      !state.objections.has(player.id)
    ));
    const objector = aiVoters.find(() => Math.random() < 0.22);
    if (objector && state.objections.size < 2) {
      objectToProposal(objector.id);
      return;
    }
    if (!isViewerTurn()) approveProposal();
  }
}

function scheduleAiAct() {
  clearAiTimer();
  if (["gameOver", "seatSelect", "discussion", "courtReveal"].includes(state.phase)) return;
  if (isViewerTurn()) return;
  state.aiTimer = setTimeout(aiAct, 5000);
}

function scheduleTalkReveal() {
  clearTalkTimer();
  if (state.phase !== "discussion") return;
  if (state.visibleTalkCount >= state.tableTalk.length) return;
  state.talkTimer = setTimeout(() => {
    state.visibleTalkCount += 1;
    render();
  }, 6000);
}

function choosePlayer(id) {
  const player = state.players.find((item) => item.id === id);
  if (!player || player.sacrificed) return;

  if (state.phase === "chooseKing") {
    state.roles.king = id;
    state.phase = "appointCourt";
    addLog(`${playerName(id)} 被选为第一任国王。`);
    render();
    return;
  }

  if (state.phase === "appointCourt") {
    if (state.roles.king !== state.viewerId) return;
    if (id === state.roles.king || state.previousCourt.has(id)) return;
    if (state.selectedPlayers.has(id)) state.selectedPlayers.delete(id);
    else if (state.selectedPlayers.size < 2) state.selectedPlayers.add(id);
    render();
    return;
  }

  if (["exchangeSkill", "inspectSkill", "reselectKnight"].includes(state.phase) && state.roles.king !== state.viewerId) return;
  if (state.phase === "jokerConvert" && bigJoker()?.id !== state.viewerId) return;
  if (["exchangeSkill", "inspectSkill", "jokerConvert", "reselectKnight"].includes(state.phase)) {
    toggleSkillSelection(id);
  }
}

function confirmCourt() {
  const picked = [...state.selectedPlayers];
  if (picked.length !== 2) return;
  state.roles.queen = picked[0];
  state.roles.knight = picked[1];
  if (bombJoker()?.id === state.roles.queen && state.roles.king !== state.roles.queen) {
    state.bombQueenSelectors.add(state.roles.king);
    addLog(`${playerName(state.roles.king)} 曾选择王炸担任王后，已被王炸记住。`);
  }
  state.selectedPlayers = new Set();
  state.flashingCourtIds = new Set([state.roles.queen, state.roles.knight]);
  state.offers = { king: [], queen: [] };
  state.choices = { king: null, queen: null, knight: null };
  state.phase = "courtReveal";
  addLog(`国王任命 ${playerName(picked[0])} 为王后，${playerName(picked[1])} 为骑士。`);
  render();
  startCourtRevealTimer();
}

function startCourtRevealTimer() {
  clearCourtTimer();
  state.courtTimer = setTimeout(dealRoyalCards, 5000);
}

function dealRoyalCards() {
  clearCourtTimer();
  if (state.phase !== "courtReveal") return;
  state.flashingCourtIds = new Set();
  state.offers.king = drawCards();
  state.offers.queen = drawCards();
  state.phase = "kingChoice";
  addLog("王后和骑士确认完毕，国王与王后各自收到 2 张暗牌。");
  render();
}

function canBombSelfDetonate() {
  const bomb = bombJoker();
  return Boolean(bomb && !bomb.sacrificed && !state.bombExploded && state.phase !== "seatSelect" && state.phase !== "gameOver");
}

function selfDetonateBomb() {
  const bomb = bombJoker();
  if (!bomb || state.bombExploded) return;
  const targets = [...state.bombQueenSelectors].filter((id) => id !== bomb.id);
  targets.forEach((id) => {
    const player = state.players.find((item) => item.id === id);
    if (player) player.sacrificed = true;
  });
  state.bombExploded = true;
  addLog(`王炸自爆：淘汰所有曾选择王炸当王后的玩家，共 ${targets.length} 人。`);
  if (targets.includes(state.roles.king)) state.roles.king = nextClockwisePlayerId(state.roles.king);
  if (targets.includes(state.roles.queen)) state.roles.queen = null;
  if (targets.includes(state.roles.knight)) state.roles.knight = null;
  render();
}

function confirmNewKnight() {
  const [id] = [...state.selectedPlayers];
  if (!id) return;
  state.roles.knight = id;
  state.selectedPlayers = new Set();
  state.phase = "knightChoice";
  addLog(`国王重新选择 ${playerName(id)} 为骑士，继续处理当前两张牌。`);
  render();
}

function chooseRoyalCard(role, faction) {
  state.choices[role] = faction;
  addLog(`${ROLE_LABELS[role]} 已暗中选择一张牌。`);
  state.phase = role === "king" ? "queenChoice" : "knightChoice";
  render();
}

function chooseKnightCard(faction) {
  state.choices.knight = faction;
  addLog(`骑士打出${factionName(faction)}牌，棋子沿${factionName(faction)}箭头移动。`);
  movePiece(faction);
}

function sacrificeKnight() {
  const knight = state.players.find((player) => player.id === state.roles.knight);
  if (!knight) return;
  knight.sacrificed = true;
  state.roles.knight = null;
  state.selectedPlayers = new Set();
  state.phase = "reselectKnight";
  addLog(`中后期：${knight.name} 触发骑士牺牲，国王需要重新选择骑士。`);
  render();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTargetPosition(faction) {
  const { row, col } = state.position;
  if (row === 0) return state.position;
  const key = `${row}-${col}`;
  const effectiveFaction = faction === "joker" ? jokerArrowOverrides[key] || "joker" : faction;
  const nextRow = row - 1;
  const currentX = rowLayouts[row][col];
  const wantedX = effectiveFaction === "spade" ? currentX - 1 : effectiveFaction === "heart" ? currentX + 1 : currentX;
  const nextCol = rowLayouts[nextRow].reduce((best, x, index) => (
    Math.abs(x - wantedX) < Math.abs(rowLayouts[nextRow][best] - wantedX) ? index : best
  ), 0);
  return { row: nextRow, col: clamp(nextCol, 0, boardRows[nextRow].length - 1) };
}

function jokerArrowForTile(key) {
  if (jokerArrowOverrides[key] === "spade") return "↖";
  if (jokerArrowOverrides[key] === "heart") return "↗";
  return "↑";
}

function movePiece(faction) {
  state.position = getTargetPosition(faction);
  state.pendingMoveFaction = faction;
  state.pendingLanding = {
    winner: goalWinner(),
    skill: skillTiles[`${state.position.row}-${state.position.col}`] || null,
  };
  state.tableTalk = discussionLines();
  state.visibleTalkCount = state.tableTalk.length ? 1 : 0;
  state.phase = "discussion";
  addLog("棋子走完一步，所有玩家开始发言分析身份。");
  render();
}

function suspicionFor(player) {
  const candidates = activePlayers().filter((item) => item.id !== player.id);
  const target = randomItem(candidates) || player;
  const guess = randomItem(Object.keys(FACTIONS));
  const played = state.pendingMoveFaction ? factionName(state.pendingMoveFaction) : "未知";
  const claim = cardClaimFor(player);
  const roleLine = player.id === state.roles.king
    ? `我是本轮国王，我声称自己的两张牌是${claim}；但国王发言可以撒谎，桌面公开事实仍然只有骑士最终打出的牌。`
    : player.id === state.roles.queen
      ? `我是本轮王后，我声称自己的两张牌是${claim}；我不知道国王手里是什么，而且王后也可以撒谎。`
      : player.id === state.roles.knight
        ? `我是本轮骑士，我声称收到的两张牌是${claim}，公开打出了${played}；骑士也可以撒谎。`
        : `我不是本轮三职，只能根据骑士公开打出的${played}和三职位置来判断。`;
  const tones = [
    `${roleLine} 我先重点观察 ${playerName(target.id)}，他可能更像${factionName(guess)}。`,
    `${roleLine} 如果${played}方向对某阵营更有利，那 ${playerName(target.id)} 的站位和发言要被验证。`,
    `${roleLine} 我现在不直接定死身份，但 ${playerName(target.id)} 下一轮如果继续顺着同一方向走，就很可疑。`,
    `${roleLine} 这一轮信息点不是国王或王后的暗牌，而是骑士打出的${played}和谁从中获利。`,
  ];
  return randomItem(tones);
}

function claimedCardName(card) {
  return factionName(card);
}

function maybeLieCards(cards) {
  const pool = Object.keys(FACTIONS);
  return cards.map((card) => (Math.random() < 0.45 ? randomItem(pool) : card));
}

function cardClaimFor(player) {
  if (player.id === state.roles.king) return maybeLieCards(state.offers.king).map(claimedCardName).join("、") || "未知";
  if (player.id === state.roles.queen) return maybeLieCards(state.offers.queen).map(claimedCardName).join("、") || "未知";
  if (player.id === state.roles.knight) return maybeLieCards([state.choices.king, state.choices.queen].filter(Boolean)).map(claimedCardName).join("、") || "未知";
  return "";
}

function discussionLines() {
  return activePlayers().map((player) => ({
    id: player.id,
    text: suspicionFor(player),
  }));
}

function tableSummary() {
  const landing = state.pendingLanding || {};
  const parts = [
    `本步由骑士打出${state.pendingMoveFaction ? factionName(state.pendingMoveFaction) : "未知"}，棋子已经移动。`,
    `本轮信息链：国王 ${playerName(state.roles.king)}，王后 ${playerName(state.roles.queen)}，骑士 ${playerName(state.roles.knight)}。`,
  ];
  if (landing.winner) parts.push(`棋子已经到达${factionName(landing.winner)}终点，本局即将结算。`);
  else if (landing.skill) parts.push(`棋子踩到${landing.skill}技能格，发言后会进入${landing.skill}方案。`);
  else parts.push("棋子没有踩到技能格，发言后会进入下一轮并顺时针换国王。");
  if (state.previousCourt.size) parts.push(`上一轮王后/骑士本轮禁选：${[...state.previousCourt].map(playerName).join("、")}。`);
  parts.push("像阿瓦隆一样，先看谁在推动棋子靠近哪边终点，再看国王、王后、骑士的选择是否互相配合。");
  return parts;
}

function continueAfterDiscussion() {
  if (state.phase !== "discussion") return;
  clearTalkTimer();
  const faction = state.pendingMoveFaction;
  if (faction === "joker" && beginJokerConversion()) {
    state.pendingMoveFaction = null;
    state.tableTalk = [];
    state.visibleTalkCount = 0;
    render();
    return;
  }
  state.pendingMoveFaction = null;
  state.tableTalk = [];
  state.visibleTalkCount = 0;
  resolveLanding();
}

function beginJokerConversion() {
  const big = bigJoker();
  const candidates = jokerConversionCandidates();
  if (!big || candidates.length === 0) {
    addLog("小丑移动触发转化，但没有未被查验的其他阵营玩家可选。");
    return false;
  }
  state.phase = "jokerConvert";
  state.selectedPlayers = new Set();
  addLog("小丑移动触发感染：大王暗中选择 1 名未被查验的其他阵营玩家转化为小王。");
  return true;
}

function resolveLanding() {
  const landing = state.pendingLanding || {
    winner: goalWinner(),
    skill: skillTiles[`${state.position.row}-${state.position.col}`] || null,
  };
  state.pendingLanding = null;

  if (landing.winner) {
    state.phase = "gameOver";
    addLog(`${factionName(landing.winner)}阵营抵达终点，游戏结束。`);
    render();
    return;
  }

  if (landing.skill === "交换") {
    state.currentSkill = "交换";
    resetProposal();
    state.phase = "exchangeSkill";
    state.selectedPlayers = new Set();
    addLog("棋子进入交换格：国王提出 3 人交换方案，随后开启抉择。");
  } else if (landing.skill === "查验") {
    state.currentSkill = "查验";
    resetProposal();
    state.phase = "inspectSkill";
    state.selectedPlayers = new Set();
    addLog("棋子进入查验格：国王提出 1 人查验方案，随后开启抉择。");
  } else {
    nextRound();
    return;
  }
  render();
}

function goalWinner() {
  const key = `${state.position.row}-${state.position.col}`;
  if (goalTiles.spade.has(key)) return "spade";
  if (goalTiles.joker.has(key)) return "joker";
  if (goalTiles.heart.has(key)) return "heart";
  return null;
}

function nextRound() {
  state.previousCourt = new Set([state.roles.queen, state.roles.knight].filter(Boolean));
  state.round += 1;
  const next = rotateKing("棋子走完一步");
  state.phase = next ? "appointCourt" : "gameOver";
  state.currentSkill = null;
  resetProposal();
  addLog(`进入第 ${state.round} 轮。`);
  render();
}

function toggleSkillSelection(id) {
  if (state.phase === "exchangeSkill") {
    if (state.selectedPlayers.has(id)) state.selectedPlayers.delete(id);
    else if (state.selectedPlayers.size < 3) state.selectedPlayers.add(id);
  }
  if (state.phase === "inspectSkill") state.selectedPlayers = new Set([id]);
  if (state.phase === "jokerConvert" && jokerConversionCandidates().some((player) => player.id === id)) state.selectedPlayers = new Set([id]);
  if (state.phase === "reselectKnight") {
    const player = state.players.find((item) => item.id === id);
    if (player && !player.sacrificed && !state.previousCourt.has(id) && id !== state.roles.king && id !== state.roles.queen) {
      state.selectedPlayers = new Set([id]);
    }
  }
  render();
}

function proposeExchange() {
  const picked = [...state.selectedPlayers];
  if (picked.length === 3) beginDecision({ type: "交换", targets: picked });
}

function proposeInspect() {
  const [id] = [...state.selectedPlayers];
  if (id) beginDecision({ type: "查验", targets: [id] });
}

function beginDecision(proposal) {
  state.proposal = proposal;
  state.objections = new Set();
  state.phase = "decision";
  addLog(`${playerName(state.roles.king)} 提出${proposal.type}方案：${proposal.targets.map(playerName).join("、")}。`);
  render();
}

function objectToProposal(playerId) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || player.sacrificed || player.id === state.roles.king || player.objectionVotes <= 0 || state.objections.has(playerId)) return;
  player.objectionVotes -= 1;
  state.objections.add(playerId);
  addLog(`${player.name} 使用 1 张反对票反对方案，剩余 ${player.objectionVotes} 张。`);

  if (state.objections.size >= 2) {
    const next = nextClockwisePlayerId(state.roles.king);
    state.roles = { king: next, queen: null, knight: null };
    state.selectedPlayers = new Set();
    resetProposal();
    state.phase = state.currentSkill === "交换" ? "exchangeSkill" : "inspectSkill";
    addLog(`已有 2 人反对，方案作废。国王顺时针交给 ${playerName(next)} 重新提出${state.currentSkill}方案。`);
  }
  render();
}

function approveProposal() {
  if (!state.proposal) return;
  if (state.proposal.type === "交换") executeExchange(state.proposal.targets);
  if (state.proposal.type === "查验") executeInspect(state.proposal.targets[0]);
}

function executeExchange(picked) {
  const before = picked.map((id) => playerIdentity(id));
  const rotated = [before[2], before[0], before[1]];
  picked.forEach((id, index) => applyIdentity(state.players.find((item) => item.id === id), rotated[index]));
  addLog(`交换方案通过：${picked.map(playerName).join("、")} 的身份已相互交换。`);
  if (!state.midgameUnlocked) addLog("技能已触发并结算：下一轮开始进入中后期，骑士可选择牺牲。");
  state.midgameUnlocked = true;
  nextRound();
}

function executeInspect(id) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  const real = playerFaction(id);
  const falseOptions = Object.keys(FACTIONS).filter((faction) => faction !== real);
  const result = falseOptions[Math.floor(Math.random() * falseOptions.length)];
  player.inspected = true;
  addLog(`查验方案通过：${playerName(id)} 的结果显示为${factionName(result)}（排除真实身份后的二选一）。`);
  if (!state.midgameUnlocked) addLog("技能已触发并结算：下一轮开始进入中后期，骑士可选择牺牲。");
  state.midgameUnlocked = true;
  nextRound();
}

function confirmJokerConversion() {
  const [id] = [...state.selectedPlayers];
  const target = state.players.find((player) => player.id === id);
  const big = bigJoker();
  if (!target || !big || target.inspected || target.faction === "joker") return;
  target.faction = "joker";
  target.jokerRank = "小王";
  state.bigKnownInfectedIds.add(target.id);
  addLog(`大王完成一次感染。除大王和被感染者本人外，其他阵营不知道谁被感染。`);
  resolveLanding();
}

function renderPlayers() {
  els.playerList.innerHTML = "";
  state.players.forEach((player) => {
    const button = document.createElement("button");
    button.className = "player-card";
    button.dataset.playerId = String(player.id);
    if (state.selectedPlayers.has(player.id)) button.classList.add("selected");
    if (player.inspected) button.classList.add("inspected");
    if (player.sacrificed) button.classList.add("sacrificed");
    if (state.previousCourt.has(player.id)) button.classList.add("court-banned");
    if (state.visibleTeamIds.has(player.id)) button.classList.add("team-known");
    if (state.flashingTeamIds.has(player.id)) button.classList.add("team-flash");
    if (state.flashingCourtIds.has(player.id)) button.classList.add("court-flash");
    Object.keys(state.roles).forEach((role) => {
      if (state.roles[role] === player.id) button.classList.add(role);
    });
    button.type = "button";
    button.addEventListener("click", () => choosePlayer(player.id));

    const tags = Object.entries(state.roles).filter(([, id]) => id === player.id).map(([role]) => ROLE_LABELS[role]).join(" / ");
    const viewer = state.players.find((item) => item.id === state.viewerId);
    const bigKnowsInfected = viewer?.jokerRank === "大王" && state.bigKnownInfectedIds.has(player.id);
    const visibleIdentity = player.id === state.viewerId
      ? identityLabel(player)
      : bigKnowsInfected
        ? "感染小王"
        : state.visibleTeamIds.has(player.id)
          ? "队友"
          : "未知";
    const meta = [
      tags || "未任命",
      `反对票 ${player.objectionVotes}`,
      state.previousCourt.has(player.id) ? "<mark>本轮禁选</mark>" : "",
      player.inspected ? "<mark>已查验</mark>" : "",
      player.sacrificed ? "<mark>已牺牲</mark>" : "",
    ].filter(Boolean).join("");

    button.innerHTML = `
      <span class="avatar">${player.id}</span>
      <span class="player-body">
        ${playerNameStack(player.id)}
        <small class="player-meta">${meta}</small>
      </span>
      <span class="identity ${visibleIdentity === "未知" ? "" : FACTIONS[player.faction].className}">${visibleIdentity}</span>
    `;
    els.playerList.appendChild(button);
  });

  const viewer = state.players.find((player) => player.id === state.viewerId);
  const spades = viewer?.faction === "spade" ? [...state.visibleTeamIds] : [];
  els.spadeIntel.innerHTML = spades.length ? `你的黑桃队友：${playerNameStackList(spades)}` : "非黑桃玩家不可见。";

  const jokerTeam = viewer?.faction === "joker" ? [...state.visibleTeamIds] : [];
  if (viewer?.jokerRank === "大王") {
    const infected = [...state.bigKnownInfectedIds];
    els.jokerIntel.innerHTML = infected.length ? `你感染过：${playerNameStackList(infected)}` : "你是大王；目前还没有感染记录。";
  } else {
    els.jokerIntel.innerHTML = jokerTeam.length ? `你知道的大王：${playerNameStackList(jokerTeam)}` : "小王只知道大王身份，小王之间互不知晓。";
  }
}

function tileStyle(row, col) {
  const stepX = 106;
  const stepY = 86;
  return {
    x: 44 + rowLayouts[row][col] * stepX,
    y: 24 + row * stepY,
  };
}

function syncViewportHeight() {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}

function updateBoardScale() {
  const wrap = els.boardStage?.parentElement;
  if (!wrap || !els.boardStage) return;
  const scale = Math.min(
    1,
    Math.max(0.42, (wrap.clientWidth - 4) / BOARD_SIZE.width),
    Math.max(0.42, (wrap.clientHeight - 4) / BOARD_SIZE.height),
  );
  els.boardStage.style.setProperty("--board-scale", scale.toFixed(3));
  els.boardStage.style.setProperty("--board-width", `${Math.ceil(BOARD_SIZE.width * scale)}px`);
  els.boardStage.style.setProperty("--board-height", `${Math.ceil(BOARD_SIZE.height * scale)}px`);
}

function renderBoard() {
  els.hexBoard.innerHTML = "";
  boardRows.forEach((cols, row) => {
    cols.forEach((col) => {
      const key = `${row}-${col}`;
      const hex = document.createElement("div");
      hex.className = "hex";
      if (goalTiles.spade.has(key)) hex.classList.add("goal-spade");
      if (goalTiles.joker.has(key)) hex.classList.add("goal-joker");
      if (goalTiles.heart.has(key)) hex.classList.add("goal-heart");
      if (row === finalRow && col === 0) hex.classList.add("start");
      if (skillTiles[key]) hex.classList.add("skill");
      if (state.position.row === row && state.position.col === col) hex.classList.add("current");

      const { x, y } = tileStyle(row, col);
      hex.style.left = `${x}px`;
      hex.style.top = `${y}px`;

      let label = "";
      let icon = "";
      if (goalTiles.spade.has(key)) { label = "黑桃终点"; icon = "♠"; }
      else if (goalTiles.joker.has(key)) { label = "王牌终点"; icon = "J"; }
      else if (goalTiles.heart.has(key)) { label = "红桃终点"; icon = "♥"; }
      else if (row === finalRow) { label = "起点"; icon = "START"; }
      else if (skillTiles[key]) { label = skillTiles[key]; icon = skillTiles[key] === "交换" ? "⇄" : "⌕"; }

      hex.innerHTML = `
        <div class="hex-label"><span class="hex-icon">${icon}</span><span>${label}</span></div>
        ${row > 0 ? `<div class="arrows"><span class="arrow spade">↖</span><span class="arrow joker">${jokerArrowForTile(key)}</span><span class="arrow heart">↗</span></div>` : ""}
      `;
      els.hexBoard.appendChild(hex);
    });
  });
  renderPiece();
  requestAnimationFrame(updateBoardScale);
}

function renderPiece() {
  const { x, y } = tileStyle(state.position.row, state.position.col);
  const target = { x: x + 27, y: y + 34 };
  const start = state.piecePixel || target;
  const piece = document.createElement("div");
  piece.className = "piece";
  piece.textContent = "💎";
  piece.style.left = `${start.x}px`;
  piece.style.top = `${start.y}px`;
  els.hexBoard.appendChild(piece);
  requestAnimationFrame(() => {
    piece.style.left = `${target.x}px`;
    piece.style.top = `${target.y}px`;
  });
  state.piecePixel = target;
}

function renderRoles() {
  els.roleSummary.innerHTML = ["king", "queen", "knight"]
    .map((role) => `<div class="role-pill ${role}"><span>${ROLE_LABELS[role]}</span><strong>${playerNameStack(state.roles[role])}</strong></div>`)
    .join("");
}

function phaseCopy() {
  const map = {
    chooseKing: ["选出国王", "第一轮点击左侧任意玩家作为国王；之后每走一步自动顺时针轮换。"],
    appointCourt: ["任命王后与骑士", "点击选择 2 名非国王玩家。第一名成为王后，第二名成为骑士。骑士权利比王后大，通常会选择你认为的队友；上轮王后和骑士本轮禁选。"],
    courtReveal: ["王后与骑士确认", "国王刚选出的王后和骑士会闪烁 5 秒。5 秒后，国王与王后各自收到暗牌。"],
    kingChoice: ["国王选择牌", "国王收到红桃、黑桃、小丑中的随机 2 张牌，可出现重复。AI 会思考 5 秒后选择。"],
    queenChoice: ["王后选择牌", "王后不知道国王的牌与选择，也从自己的 2 张牌中选择 1 张交给骑士。AI 会思考 5 秒后选择。"],
    knightChoice: ["骑士打出牌", state.midgameUnlocked ? "中后期：骑士看到国王和王后交出的 2 张牌，可选择打出牌，也可牺牲自己让国王重选骑士。AI 会思考 5 秒后行动。" : "骑士看到国王和王后交出的 2 张牌，决定棋子走向。AI 会思考 5 秒后出牌。"],
    exchangeSkill: ["交换技能", "国王选择 3 名玩家提出交换方案。若 2 人反对，则下一人当国王重新提案。技能结算后的下一轮进入中后期。"],
    inspectSkill: ["查验技能", "国王选择 1 名玩家提出查验方案。查验结果在排除真实身份后的另外 2 个阵营中随机显示 1 个。技能结算后的下一轮进入中后期。"],
    decision: ["抉择表决", "其他玩家可各出 1 张反对票；当 2 人反对时，方案作废并由下一人当国王。"],
    discussion: ["全员发言", "棋子每走完一步，所有玩家都会按顺序发言。每 6 秒弹出下一条，是否结束讨论由玩家决定。"],
    jokerConvert: ["大王转化", "本回合骑士最终打出小丑牌。大王选择 1 名未被查验、且当前不是小丑阵营的玩家转化为小王。"],
    reselectKnight: ["骑士牺牲", "骑士已牺牲。国王需要从未牺牲、非国王、非王后的玩家中重新选择骑士。"],
    gameOver: ["游戏结束", "棋子已抵达阵营终点。"],
  };
  return map[state.phase];
}

function renderAction() {
  const [title, copy] = phaseCopy();
  els.phaseTitle.textContent = title;
  els.actionHeading.textContent = title;
  els.actionArea.innerHTML = `<p class="copy">${copy}</p>`;
  els.skillArea.classList.add("hidden");
  els.skillArea.innerHTML = "";

  if (state.phase === "chooseKing") {
    els.actionArea.innerHTML += `<div class="button-row"><button class="primary-btn" id="randomKingBtn" type="button">随机选国王</button></div>`;
    document.querySelector("#randomKingBtn").addEventListener("click", () => choosePlayer(activePlayers()[Math.floor(Math.random() * activePlayers().length)].id));
  }
  if (state.phase === "appointCourt") renderCourtPicker();
  if (state.phase === "courtReveal") renderCourtReveal();
  if (state.phase === "kingChoice") renderCardChoices("king", state.offers.king);
  if (state.phase === "queenChoice") renderCardChoices("queen", state.offers.queen);
  if (state.phase === "knightChoice") renderKnightChoices();
  if (state.phase === "exchangeSkill") renderExchange();
  if (state.phase === "inspectSkill") renderInspect();
  if (state.phase === "decision") renderDecision();
  if (state.phase === "discussion") renderDiscussion();
  if (state.phase === "jokerConvert") renderJokerConversion();
  if (state.phase === "reselectKnight") renderReselectKnight();
  if (state.phase === "gameOver") {
    els.actionArea.innerHTML += `<div class="button-row"><button class="primary-btn" id="newGameBtn" type="button">重新开始</button></div>`;
    document.querySelector("#newGameBtn").addEventListener("click", resetGame);
  }
  renderBombAction();
}

function renderBombAction() {
  const bomb = bombJoker();
  if (!bomb || bomb.id !== state.viewerId || state.bombExploded || state.phase === "seatSelect" || state.phase === "gameOver") return;
  els.actionArea.innerHTML += `
    <div class="bomb-panel">
      <strong>王炸能力</strong>
      <p>自爆后，所有曾选择你当王后的玩家会被淘汰；你本人不计入。</p>
      <button class="primary-btn" id="bombSelfDetonateBtn" type="button">王炸自爆</button>
    </div>
  `;
  document.querySelector("#bombSelfDetonateBtn").addEventListener("click", selfDetonateBomb);
}

function renderDiscussion() {
  const visibleTalk = state.tableTalk.slice(0, state.visibleTalkCount);
  const nextSpeaker = state.tableTalk[state.visibleTalkCount];
  els.actionArea.innerHTML += `
    <div class="table-summary">
      <strong>局势总结</strong>
      <ul>
        ${tableSummary().map((item) => `<li>${logWithStackedNames(item)}</li>`).join("")}
      </ul>
    </div>
    <div class="talk-progress">
      已发言 ${visibleTalk.length}/${state.tableTalk.length}
      ${nextSpeaker ? `<span>下一位：${playerNameStack(nextSpeaker.id)}，6 秒后弹出</span>` : "<span>全部发言完毕，玩家可决定是否继续。</span>"}
    </div>
    <div class="talk-list">
      ${visibleTalk.map((line) => `
        <div class="talk-item">
          <strong>${playerNameStack(line.id)}</strong>
          <p>${logWithStackedNames(line.text)}</p>
        </div>
      `).join("")}
    </div>
    <div class="button-row"><button class="primary-btn" id="continueDiscussionBtn" type="button">结束讨论并继续</button></div>
  `;
  document.querySelector("#continueDiscussionBtn").addEventListener("click", continueAfterDiscussion);
}

function renderCourtPicker() {
  const banned = playerNameStackList([...state.previousCourt]);
  const disabled = state.roles.king === state.viewerId ? "" : "disabled";
  els.actionArea.innerHTML += `
    <p class="select-hint">当前国王：${playerNameStack(state.roles.king)}。已选择 ${state.selectedPlayers.size}/2。上轮王后/骑士本轮禁选：${banned}</p>
    <div class="button-row two">
      <button class="ghost-btn" id="clearCourtBtn" type="button" ${disabled}>清空</button>
      <button class="primary-btn" id="confirmCourtBtn" type="button" ${state.selectedPlayers.size === 2 && !disabled ? "" : "disabled"}>确认任命</button>
    </div>
  `;
  document.querySelector("#clearCourtBtn").addEventListener("click", () => { state.selectedPlayers = new Set(); render(); });
  document.querySelector("#confirmCourtBtn").addEventListener("click", confirmCourt);
}

function renderCourtReveal() {
  els.actionArea.innerHTML += `
    <div class="table-summary">
      <strong>等待发牌</strong>
      <ul>
        <li>王后：${playerNameStack(state.roles.queen)}</li>
        <li>骑士：${playerNameStack(state.roles.knight)}</li>
        <li>两名玩家正在闪烁标记，5 秒后国王和王后收到暗牌。</li>
      </ul>
    </div>
  `;
}

function renderCardChoices(role, cards) {
  const canAct = state.roles[role] === state.viewerId;
  els.actionArea.innerHTML += `
    <div class="choice-grid two">
      ${cards.map((card, index) => `
        <button class="choice-card" data-card="${card}" data-choice-index="${index}" type="button" ${canAct ? "" : "disabled"}>
          <span>${playerNameStack(state.roles[role])} 的第 ${index + 1} 张</span>
          ${canAct
            ? `<span class="card-face ${FACTIONS[card].className}">${FACTIONS[card].symbol} ${factionName(card)}</span>`
            : `<span class="card-face hidden-card">暗牌</span>`}
        </button>
      `).join("")}
    </div>
  `;
  document.querySelectorAll("[data-card]").forEach((button) => button.addEventListener("click", () => chooseRoyalCard(role, button.dataset.card)));
}

function renderKnightChoices() {
  const cards = [state.choices.king, state.choices.queen];
  const canAct = state.roles.knight === state.viewerId;
  els.actionArea.innerHTML += `
    <div class="choice-grid two">
      ${cards.map((card, index) => `
        <button class="choice-card" data-knight-card="${card}" data-knight-choice-index="${index}" type="button" ${canAct ? "" : "disabled"}>
          <span>${index === 0 ? "国王" : "王后"}交来的牌</span>
          ${canAct
            ? `<span class="card-face ${FACTIONS[card].className}">${FACTIONS[card].symbol} ${factionName(card)}</span>`
            : `<span class="card-face hidden-card">暗牌</span>`}
        </button>
      `).join("")}
    </div>
    ${state.midgameUnlocked ? `<div class="button-row"><button class="ghost-btn" id="sacrificeKnightBtn" type="button" ${canAct ? "" : "disabled"}>骑士牺牲，国王重选骑士</button></div>` : ""}
  `;
  document.querySelectorAll("[data-knight-card]").forEach((button) => button.addEventListener("click", () => chooseKnightCard(button.dataset.knightCard)));
  document.querySelector("#sacrificeKnightBtn")?.addEventListener("click", sacrificeKnight);
}

function renderExchange() {
  const canAct = state.roles.king === state.viewerId;
  els.skillArea.classList.remove("hidden");
  els.skillArea.innerHTML = `
    <p class="copy">当前国王：${playerNameStack(state.roles.king)}。选择 3 名玩家后提出交换方案，身份按选择顺序轮换。</p>
    <p class="select-hint">已选择 ${state.selectedPlayers.size}/3</p>
    <div class="button-row"><button class="primary-btn" id="proposeExchangeBtn" type="button" ${canAct && state.selectedPlayers.size === 3 ? "" : "disabled"}>提出交换方案</button></div>
  `;
  document.querySelector("#proposeExchangeBtn").addEventListener("click", proposeExchange);
}

function renderInspect() {
  const canAct = state.roles.king === state.viewerId;
  els.skillArea.classList.remove("hidden");
  els.skillArea.innerHTML = `
    <p class="copy">当前国王：${playerNameStack(state.roles.king)}。选择 1 名玩家后提出查验方案。</p>
    <p class="select-hint">目标：${playerNameStack([...state.selectedPlayers][0])}</p>
    <div class="button-row"><button class="primary-btn" id="proposeInspectBtn" type="button" ${canAct && state.selectedPlayers.size === 1 ? "" : "disabled"}>提出查验方案</button></div>
  `;
  document.querySelector("#proposeInspectBtn").addEventListener("click", proposeInspect);
}

function renderDecision() {
  const voters = activePlayers().filter((player) => player.id !== state.roles.king);
  els.skillArea.classList.remove("hidden");
  els.skillArea.innerHTML = `
    <p class="copy">方案：${state.proposal.type} ${playerNameStackList(state.proposal.targets)}</p>
    <p class="select-hint">反对 ${state.objections.size}/2。达到 2 人反对时，顺时针下一人成为国王。</p>
    <div class="voter-grid">
      ${voters.map((player) => `
        <button class="ghost-btn voter-btn" data-objector-id="${player.id}" type="button" ${player.id === state.viewerId && player.objectionVotes > 0 && !state.objections.has(player.id) ? "" : "disabled"}>
          ${playerNameStack(player.id)}<small>剩余 ${player.objectionVotes} 张</small>
        </button>
      `).join("")}
    </div>
    <div class="button-row"><button class="primary-btn" id="approveProposalBtn" type="button" ${isViewerTurn() || state.roles.king === state.viewerId ? "" : "disabled"}>无人继续反对，通过方案</button></div>
  `;
  document.querySelectorAll("[data-objector-id]").forEach((button) => button.addEventListener("click", () => objectToProposal(Number(button.dataset.objectorId))));
  document.querySelector("#approveProposalBtn").addEventListener("click", approveProposal);
}

function renderJokerConversion() {
  const big = bigJoker();
  const candidates = jokerConversionCandidates();
  const isBigViewer = big?.id === state.viewerId;
  els.skillArea.classList.remove("hidden");
  els.skillArea.innerHTML = `
    <p class="copy">${isBigViewer ? `你是大王。可选感染目标：${candidates.length} 名。` : "大王正在暗中选择感染目标，其他阵营不知道谁会被感染。"}</p>
    <p class="select-hint">目标：${isBigViewer ? playerNameStack([...state.selectedPlayers][0]) : "隐藏"}</p>
    <div class="button-row"><button class="primary-btn" id="confirmJokerConvertBtn" type="button" ${isBigViewer && state.selectedPlayers.size === 1 ? "" : "disabled"}>感染为小王并结算落点</button></div>
  `;
  document.querySelector("#confirmJokerConvertBtn").addEventListener("click", confirmJokerConversion);
}

function renderReselectKnight() {
  const candidates = activePlayers().filter((player) => player.id !== state.roles.king && player.id !== state.roles.queen);
  els.skillArea.classList.remove("hidden");
  els.skillArea.innerHTML = `
    <p class="copy">可选骑士：${candidates.length} 名。新骑士会看到当前国王和王后已交出的两张牌。</p>
    <p class="select-hint">新骑士：${playerNameStack([...state.selectedPlayers][0])}</p>
    <div class="button-row"><button class="primary-btn" id="confirmNewKnightBtn" type="button" ${state.roles.king === state.viewerId && state.selectedPlayers.size === 1 ? "" : "disabled"}>确认新骑士</button></div>
  `;
  document.querySelector("#confirmNewKnightBtn").addEventListener("click", confirmNewKnight);
}

function renderLog() {
  els.logList.innerHTML = state.log.map((item) => `<li>${logWithStackedNames(item)}</li>`).join("");
}

function render() {
  clearAiTimer();
  els.roundNo.textContent = state.round;
  renderPlayers();
  renderBoard();
  renderRoles();
  renderAction();
  renderLog();
  scheduleAiAct();
  scheduleTalkReveal();
}

window.addEventListener("resize", () => {
  syncViewportHeight();
  updateBoardScale();
});
window.addEventListener("orientationchange", () => {
  syncViewportHeight();
  requestAnimationFrame(updateBoardScale);
});
window.visualViewport?.addEventListener("resize", () => {
  syncViewportHeight();
  updateBoardScale();
});

syncViewportHeight();
els.resetBtn.addEventListener("click", resetGame);
resetGame();
