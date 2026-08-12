const VIEW_IDS = {
  landing: "view-landing",
  lobby: "view-lobby",
  "role-reveal": "view-role-reveal",
  "night-werewolf": "view-night-werewolf",
  "night-seer": "view-night-seer",
  "night-doctor": "view-night-doctor",
  "hunter-revenge": "view-hunter-revenge",
  day: "view-day",
  "day-vote": "view-day-vote",
  "game-over": "view-game-over",
};

export function renderRoute(state) {
  const activeView = state.roomId ? state.phase : "landing";

  Object.entries(VIEW_IDS).forEach(([name, id]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = name !== activeView;
  });

  const roomCodeDisplay = document.getElementById("room-code-display");
  const btnLeaveRoom = document.getElementById("btn-leave-room");
  if (roomCodeDisplay) {
    if (state.roomId) {
      roomCodeDisplay.hidden = false;
      roomCodeDisplay.textContent = `ห้อง: ${state.roomId}`;
    } else {
      roomCodeDisplay.hidden = true;
    }
  }
  if (btnLeaveRoom) {
    btnLeaveRoom.hidden = !state.roomId;
  }
}
