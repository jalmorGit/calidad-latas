const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.72;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("No se pudo comprimir la imagen"));
      },
      "image/jpeg",
      quality
    );
  });
}

export function formatMegabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

export async function compressImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} no es una imagen compatible.`);
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`No se pudo leer la imagen ${file.name}.`));
      img.src = imageUrl;
    });

    const scale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No se pudo preparar la imagen para subirla.");
    }

    ctx.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, JPEG_QUALITY);
    const compressedName = file.name.replace(/\.[^.]+$/, "") + ".jpg";

    return new File([blob], compressedName, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
