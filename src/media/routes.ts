import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";

const appRoot = process.cwd();
const imageDirectory = path.join(appRoot, ".data", "images");
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

mkdirSync(imageDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, imageDirectory);
  },
  filename: (_request, file, callback) => {
    const extension = getSafeImageExtension(file.originalname);

    callback(null, `${Date.now()}-${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    const extension = getSafeImageExtension(file.originalname);

    if (!extension || !file.mimetype.startsWith("image/")) {
      callback(new Error("Only image uploads are allowed."));
      return;
    }

    callback(null, true);
  }
});

export const mediaRouter = Router();

mediaRouter.post("/upload/image", upload.single("image"), (request, response) => {
  if (!request.file) {
    return response.status(400).json({ errors: ["image file is required."] });
  }

  return response.status(201).json({
    filename: request.file.filename,
    image_path: `/api/images/${request.file.filename}`
  });
});

mediaRouter.get("/images/:filename", (request, response) => {
  const filename = path.basename(request.params.filename);

  if (filename !== request.params.filename || !getSafeImageExtension(filename)) {
    return response.status(400).json({ errors: ["Invalid image filename."] });
  }

  return response.sendFile(path.join(imageDirectory, filename));
});

function getSafeImageExtension(filename: string) {
  const extension = path.extname(filename).toLowerCase();

  return allowedExtensions.has(extension) ? extension : "";
}
