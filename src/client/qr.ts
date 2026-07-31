import qrcode from "qrcode-generator";

export function renderQr(target: HTMLElement, text: string): void {
  const make = (qrcode as unknown as { default?: typeof qrcode }).default ?? qrcode;
  const qr = make(0, "M");
  qr.addData(text);
  qr.make();
  target.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  const svg = target.querySelector("svg");
  if (svg) {
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Pairing QR code");
  }
}
