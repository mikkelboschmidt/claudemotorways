export let score = 0;

export function addScore(points: number) {
  score += points;
}

export function setScore(value: number) {
  score = value;
}
