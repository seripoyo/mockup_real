export function containSize(containerW: number, containerH: number, naturalW: number, naturalH: number) {
  const frameAR = naturalW / naturalH;
  const containerAR = containerW / containerH;
  if (frameAR > containerAR) {
    const w = containerW;
    const h = w / frameAR;
    return { w, h, left: (containerW - w) / 2, top: (containerH - h) / 2 };
  } else {
    const h = containerH;
    const w = h * frameAR;
    return { w, h, left: (containerW - w) / 2, top: (containerH - h) / 2 };
  }
}

export function coverSize(targetW: number, targetH: number, imgW: number, imgH: number) {
  const targetAR = targetW / targetH;
  const imgAR = imgW / imgH;
  if (imgAR > targetAR) {
    // image wider, fit height
    const h = targetH;
    const w = h * imgAR;
    const left = (targetW - w) / 2;
    return { w, h, left, top: 0 };
  } else {
    // image taller, fit width
    const w = targetW;
    const h = w / imgAR;
    const top = (targetH - h) / 2;
    return { w, h, left: 0, top };
  }
}
