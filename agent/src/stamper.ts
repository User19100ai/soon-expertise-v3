// agent/src/stamper.ts — Tamponner "TRAITÉ" sur le PDF et le copier dans le dossier parent
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { getMissionDir } from './mission-store';

export async function stampValidated(missionId: string): Promise<boolean> {
  const missionDir = getMissionDir(missionId);
  if (!missionDir) {
    logger.error('Cannot stamp: mission dir not found', { mission_id: missionId });
    return false;
  }

  const missionJson = JSON.parse(fs.readFileSync(path.join(missionDir, 'mission.json'), 'utf-8'));
  const sourceFile = missionJson.source.files[0];
  const sourcePath = path.join(missionDir, sourceFile);
  const originalName = missionJson.source.original_name || sourceFile;

  if (!fs.existsSync(sourcePath) || !originalName.toLowerCase().endsWith('.pdf')) {
    logger.warn('Cannot stamp: not a PDF or file missing', { mission_id: missionId, file: sourceFile });
    return false;
  }

  try {
    // Lire le PDF original (pas celui dans .data, celui dans Missions/)
    // D'abord chercher l'original dans Missions/
    const inboxOriginal = path.join(config.inboxPath, originalName);
    const pdfSource = fs.existsSync(inboxOriginal) ? inboxOriginal : sourcePath;
    const pdfBytes = fs.readFileSync(pdfSource);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    if (pages.length === 0) return false;

    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    const stampText = `TRAITÉ — Dr. HARANG — ${dateStr}`;

    // Bandeau vert en haut
    const bannerHeight = 28;
    const bannerY = height - bannerHeight - 5;

    firstPage.drawRectangle({
      x: 10,
      y: bannerY,
      width: width - 20,
      height: bannerHeight,
      color: rgb(0, 0.55, 0.42),
      opacity: 0.85,
    });

    const fontSize = 12;
    const textWidth = font.widthOfTextAtSize(stampText, fontSize);
    firstPage.drawText(stampText, {
      x: (width - textWidth) / 2,
      y: bannerY + 8,
      size: fontSize,
      font,
      color: rgb(1, 1, 1),
    });

    const modifiedBytes = await pdfDoc.save();

    // Nom : "Traité-Soon-Mission - DELBOS Martine - Axa - 2026-03-10.pdf"
    const traiteName = `Traité-Soon-${originalName}`;

    // Copier dans le dossier parent (Scan Expertise Claude/)
    const parentDir = path.dirname(config.inboxPath); // remonte de Missions/ vers Scan Expertise Claude/
    const destPath = path.join(parentDir, traiteName);

    fs.writeFileSync(destPath, Buffer.from(modifiedBytes));

    logger.info('PDF stamped and copied to parent folder', {
      mission_id: missionId,
      dest: traiteName,
    });

    return true;

  } catch (err) {
    logger.error('Failed to stamp PDF', { mission_id: missionId, error: String(err) });
    return false;
  }
}
