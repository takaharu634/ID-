/** Existing Savant analysis bounds in metres; do not change metric definitions here. */
export const ANALYSIS_ZONE = { left: -.254, right: .254, bottom: .45, top: 1.05 };
export function pitchProjection(width: number, height: number, bounds = { left: -.65, right: .65, bottom: .15, top: 1.4 }, padding = 24) {
  const scale = Math.min((width - 2 * padding) / (bounds.right - bounds.left), (height - 2 * padding) / (bounds.top - bounds.bottom));
  const x = (v: number) => width / 2 + (v - (bounds.left + bounds.right) / 2) * scale;
  const y = (v: number) => height / 2 - (v - (bounds.top + bounds.bottom) / 2) * scale;
  return { x, y, scale, left: x(bounds.left), top: y(bounds.top), width: (bounds.right-bounds.left)*scale, height: (bounds.top-bounds.bottom)*scale };
}
export function sprayPoint(direction: number, distance: number, homeX: number, homeY: number, scale: number) {
  const radians = direction * Math.PI / 180;
  return { x: homeX + Math.sin(radians) * distance * scale, y: homeY - Math.cos(radians) * distance * scale };
}
export function fieldSector(homeX: number, homeY: number, radius: number) {
  const left = sprayPoint(-45, radius, homeX, homeY, 1), right = sprayPoint(45, radius, homeX, homeY, 1);
  return `M${homeX} ${homeY} L${left.x} ${left.y} A${radius} ${radius} 0 0 1 ${right.x} ${right.y} Z`;
}
export function fieldFence(homeX: number, homeY: number, scale: number) {
  const points = Array.from({length:91}, (_,i) => {
    const angle = i-45, distance = 98 + 22 * (1-Math.abs(angle)/45);
    return sprayPoint(angle, distance, homeX, homeY, scale);
  });
  return `M${homeX} ${homeY} ${points.map(p=>`L${p.x} ${p.y}`).join(' ')} Z`;
}
