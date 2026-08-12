import { getState } from "../state.js";
import { startFirstNight } from "../game.js";

let initialized = false;

const ROLE_INFO = {
  werewolf: {
    icon: "🐺",
    label: "หมาป่า",
    desc: "ทุกคืนคุณจะเลือกเหยื่อร่วมกับหมาป่าตัวอื่น (ถ้ามี) กลางวันต้องกลืนกลายเป็นชาวบ้านให้แนบเนียนที่สุด",
  },
  seer: {
    icon: "🔮",
    label: "หมอดู",
    desc: "ทุกคืนคุณตรวจสอบผู้เล่น 1 คนว่าเป็นหมาป่าหรือไม่ ใช้ข้อมูลนี้นำทางหมู่บ้านอย่างระวัง — อย่าเปิดเผยตัวเร็วเกินไป",
  },
  doctor: {
    icon: "💊",
    label: "หมอ",
    desc: "ทุกคืนคุณปกป้องผู้เล่น 1 คนจากการถูกหมาป่าฆ่า (ปกป้องตัวเองได้ด้วย)",
  },
  hunter: {
    icon: "🏹",
    label: "นายพราน",
    desc: "ไม่มีความสามารถพิเศษตอนกลางคืน แต่ถ้าคุณตาย (ไม่ว่าจะโดนหมาป่าฆ่าหรือถูกโหวตออก) คุณจะได้ยิงพาผู้เล่นอีก 1 คนตายไปด้วยทันที",
  },
  villager: {
    icon: "👤",
    label: "ชาวบ้าน",
    desc: "คุณไม่มีความสามารถพิเศษ ใช้การสังเกตและพูดคุยช่วยหมู่บ้านหาหมาป่าให้เจอ",
  },
};

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-start-night").addEventListener("click", async () => {
    const { roomId } = getState();
    await startFirstNight(roomId);
  });
}

export function render(state) {
  if (state.phase !== "role-reveal") return;

  const card = document.getElementById("role-card");
  const btn = document.getElementById("btn-start-night");
  const hint = document.getElementById("role-reveal-hint");

  if (!state.mySecret) {
    card.innerHTML = "<p>กำลังแจกบทบาท...</p>";
    btn.hidden = true;
    return;
  }

  const role = state.mySecret.role;
  const info = ROLE_INFO[role] || ROLE_INFO.villager;
  card.innerHTML = `<img class="role-card-portrait role-portrait-${role}" src="assets/roles/role-${role}.jpg" alt="${info.label}" /><div class="role-badge role-${role}">${info.icon} ${info.label}</div><p class="hint">${info.desc}</p>`;

  if (state.isHost) {
    btn.hidden = false;
    hint.textContent = "รอทุกคนดูบทบาทของตัวเองให้เรียบร้อยก่อนเริ่มคืนแรก";
  } else {
    btn.hidden = true;
    hint.textContent = "รอหัวห้องเริ่มคืนแรก...";
  }
}
