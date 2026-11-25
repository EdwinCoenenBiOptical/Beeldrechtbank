// Original vector lettering: no external fonts or runtime font configuration required.
const glyphs = {
  B: "M0 10V0H3Q6 0 6 2.5T3 5H0M3 5Q6 5 6 7.5T3 10H0",
  E: "M6 0H0V10H6M0 5H5",
  L: "M0 0V10H6",
  D: "M0 0V10H2Q6 10 6 5T2 0Z",
  R: "M0 10V0H3Q6 0 6 2.5T3 5H0M3 5L6 10",
  C: "M6 1Q0 -2 0 5T6 9",
  H: "M0 0V10M6 0V10M0 5H6",
  T: "M0 0H6M3 0V10",
  A: "M0 10L3 0L6 10M1 7H5",
  N: "M0 10V0L6 10V0",
  K: "M0 0V10M6 0L0 5L6 10",
};
export function watermarkSvg(width, height) {
  const size = Math.max(12, Math.round(Math.min(width, height) / 24));
  let word = "";
  for (const [i, c] of [..."BEELDRECHTBANK"].entries())
    word += `<path transform="translate(${i * 8} 0)" d="${glyphs[c]}"/>`;
  let marks = "";
  for (let y = -height; y < height * 2; y += size * 4)
    for (let x = -width; x < width * 2; x += size * 13)
      marks += `<g transform="translate(${x} ${y}) scale(${size / 10})">${word}</g>`;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><g id="letters" transform="rotate(-25 ${width / 2} ${height / 2})" fill="none" stroke-linecap="round" stroke-linejoin="round">${marks}</g></defs><use href="#letters" stroke="black" stroke-opacity="0.20" stroke-width="1.6"/><use href="#letters" stroke="white" stroke-opacity="0.50" stroke-width="1"/></svg>`,
  );
}
