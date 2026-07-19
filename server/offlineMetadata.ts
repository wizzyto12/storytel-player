import axios from "axios";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import NodeID3 from "node-id3";
import StorytelClient from "./storytelApi";

const METADATA_VERSION = 1;
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface NamedEntity {
  name?: string;
}

export interface OfflineBook {
  id?: string | number;
  status?: number;
  book?: {
    id?: string | number;
    name?: string;
    authorsAsString?: string;
    consumableId?: string;
    largeCover?: string;
    largeCoverE?: string;
    category?: NamedEntity & { title?: string };
    language?: {
      isoValue?: string;
      name?: string;
      localizedName?: string;
    };
    series?: NamedEntity[];
    seriesOrder?: number;
  };
  abook?: {
    id?: string | number;
    narratorAsString?: string;
    description?: string;
    isbn?: string;
    publisher?: NamedEntity;
    releaseDate?: string;
    copyright?: string;
  };
  [key: string]: unknown;
}

interface OfflineBookRecord {
  version: number;
  tagged: boolean;
  savedAt: string;
  book: OfflineBook;
}

export interface PersistOfflineMetadataOptions {
  audioFilePath: string;
  book: OfflineBook;
  storytelClient: StorytelClient;
  force?: boolean;
}

export interface PersistOfflineMetadataResult {
  cached: boolean;
  tagged: boolean;
  skipped: boolean;
}

const offlineDirectory = path.join(
  process.env.USER_DATA_PATH || process.cwd(),
  "offline",
);
const booksDirectory = path.join(offlineDirectory, "books");
const coversDirectory = path.join(offlineDirectory, "covers");
const playbackMetadataDirectory = path.join(
  offlineDirectory,
  "bookmetadata",
);
const bookDetailsDirectory = path.join(offlineDirectory, "book-details");

function ensureDirectories(): void {
  for (const directory of [
    booksDirectory,
    coversDirectory,
    playbackMetadataDirectory,
    bookDetailsDirectory,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function safeIdentifier(value: unknown, label: string): string {
  const identifier = String(value ?? "");
  if (!/^[A-Za-z0-9_-]+$/.test(identifier)) {
    throw new Error(`Invalid ${label}`);
  }
  return identifier;
}

function bookIdFrom(book: OfflineBook): string {
  return safeIdentifier(book.abook?.id, "audiobook ID");
}

function consumableIdFrom(book: OfflineBook): string {
  return safeIdentifier(book.book?.consumableId, "consumable ID");
}

function bookRecordPath(bookId: string): string {
  return path.join(booksDirectory, `${bookId}.json`);
}

function playbackMetadataPath(consumableId: string): string {
  return path.join(playbackMetadataDirectory, `${consumableId}.json`);
}

function bookDetailsPath(consumableId: string): string {
  return path.join(bookDetailsDirectory, `${consumableId}.json`);
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeCoverUrl(coverUrl?: string): string | null {
  if (!coverUrl) return null;
  if (/^https?:\/\//i.test(coverUrl)) return coverUrl;
  if (coverUrl.startsWith("//")) return `https:${coverUrl}`;
  if (coverUrl.startsWith("/")) return `https://www.storytel.com${coverUrl}`;
  return null;
}

function coverExtension(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

async function downloadCover(
  bookId: string,
  coverUrl: string | null,
): Promise<{ buffer: Buffer; mime: string; filePath: string } | null> {
  if (!coverUrl) return null;

  const response = await axios.get<ArrayBuffer>(coverUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: MAX_COVER_BYTES,
  });
  const contentType = String(response.headers["content-type"] || "image/jpeg")
    .split(";")[0]
    .trim();
  const buffer = Buffer.from(response.data);
  if (buffer.length === 0 || buffer.length > MAX_COVER_BYTES) {
    throw new Error("Cover image is empty or too large");
  }

  const filePath = path.join(
    coversDirectory,
    `${bookId}${coverExtension(contentType)}`,
  );
  fs.writeFileSync(filePath, buffer);
  return { buffer, mime: contentType, filePath };
}

function cachedCoverPath(bookId: string): string | null {
  const prefix = `${bookId}.`;
  const fileName = fs
    .readdirSync(coversDirectory)
    .find((candidate) => candidate.startsWith(prefix));
  return fileName ? path.join(coversDirectory, fileName) : null;
}

function metadataTags(
  book: OfflineBook,
  cover: { buffer: Buffer; mime: string } | null,
): NodeID3.Tags {
  const title = book.book?.name || `Storytel ${bookIdFrom(book)}`;
  const author = book.book?.authorsAsString || "";
  const narrator = book.abook?.narratorAsString || "";
  const series = book.book?.series?.find((item) => item?.name)?.name;
  const releaseDate = book.abook?.releaseDate;
  const releaseYear = releaseDate?.match(/^\d{4}/)?.[0];
  const category = book.book?.category?.title || book.book?.category?.name;
  const language =
    book.book?.language?.isoValue || book.book?.language?.name || undefined;
  const publisher = book.abook?.publisher?.name;
  const seriesOrder = book.book?.seriesOrder;
  const bookId = bookIdFrom(book);
  const consumableId = consumableIdFrom(book);

  return {
    title,
    artist: author || undefined,
    album: series || title,
    performerInfo: narrator || undefined,
    genre: category || "Audiobook",
    language,
    publisher,
    copyright: book.abook?.copyright || undefined,
    originalReleaseTime: releaseDate || undefined,
    year: releaseYear,
    trackNumber:
      typeof seriesOrder === "number" && seriesOrder > 0
        ? String(seriesOrder)
        : undefined,
    comment: {
      language: "eng",
      text: `Storytel audiobook ID: ${bookId}; consumable ID: ${consumableId}`,
    },
    userDefinedText: [
      { description: "Narrator", value: narrator },
      { description: "Storytel ID", value: bookId },
      { description: "Storytel Consumable ID", value: consumableId },
    ].filter((entry) => entry.value),
    image: cover
      ? {
          mime: cover.mime,
          type: { id: 3 },
          description: "Front cover",
          imageBuffer: cover.buffer,
        }
      : undefined,
  };
}

function cachedBook(book: OfflineBook, coverPath: string | null): OfflineBook {
  const clone = JSON.parse(JSON.stringify(book)) as OfflineBook;
  if (clone.book && coverPath) {
    clone.book.largeCover = pathToFileURL(coverPath).href;
    clone.book.largeCoverE = "";
  }
  return clone;
}

async function cacheRemoteMetadata(
  storytelClient: StorytelClient,
  consumableId: string,
): Promise<void> {
  const playbackPath = playbackMetadataPath(consumableId);
  if (!fs.existsSync(playbackPath)) {
    try {
      const metadata = await storytelClient.getPlayBookMetaData(consumableId);
      writeJsonAtomically(playbackPath, metadata);
    } catch (error) {
      console.warn(`Unable to cache playback metadata: ${errorMessage(error)}`);
    }
  }

  const detailsPath = bookDetailsPath(consumableId);
  if (!fs.existsSync(detailsPath)) {
    try {
      const details = await storytelClient.getBookDetails(consumableId);
      writeJsonAtomically(detailsPath, details);
    } catch (error) {
      console.warn(`Unable to cache book details: ${errorMessage(error)}`);
    }
  }
}

export async function persistOfflineMetadata({
  audioFilePath,
  book,
  storytelClient,
  force = false,
}: PersistOfflineMetadataOptions): Promise<PersistOfflineMetadataResult> {
  ensureDirectories();
  const bookId = bookIdFrom(book);
  const consumableId = consumableIdFrom(book);
  const recordPath = bookRecordPath(bookId);
  const currentRecord = readJson<OfflineBookRecord>(recordPath);

  if (
    !force &&
    currentRecord?.version === METADATA_VERSION &&
    currentRecord.tagged &&
    fs.existsSync(playbackMetadataPath(consumableId)) &&
    fs.existsSync(bookDetailsPath(consumableId))
  ) {
    return { cached: true, tagged: true, skipped: true };
  }

  let coverPath = cachedCoverPath(bookId);
  let cover: { buffer: Buffer; mime: string } | null = null;
  try {
    const downloadedCover = await downloadCover(
      bookId,
      normalizeCoverUrl(book.book?.largeCover || book.book?.largeCoverE),
    );
    if (downloadedCover) {
      cover = {
        buffer: downloadedCover.buffer,
        mime: downloadedCover.mime,
      };
      coverPath = downloadedCover.filePath;
    }
  } catch (error) {
    console.warn(`Unable to cache cover artwork: ${errorMessage(error)}`);
    if (coverPath) {
      const buffer = fs.readFileSync(coverPath);
      cover = {
        buffer,
        mime: path.extname(coverPath) === ".png" ? "image/png" : "image/jpeg",
      };
    }
  }

  await cacheRemoteMetadata(storytelClient, consumableId);

  let tagged = false;
  try {
    await NodeID3.Promise.update(metadataTags(book, cover), audioFilePath);
    tagged = true;
  } catch (error) {
    console.warn(`Unable to write audiobook ID3 metadata: ${errorMessage(error)}`);
  }

  const record: OfflineBookRecord = {
    version: METADATA_VERSION,
    tagged,
    savedAt: new Date().toISOString(),
    book: cachedBook(book, coverPath),
  };
  writeJsonAtomically(recordPath, record);

  return { cached: true, tagged, skipped: false };
}

export function loadOfflineBooks(downloadsDirectory: string): OfflineBook[] {
  ensureDirectories();
  return fs
    .readdirSync(booksDirectory)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) =>
      readJson<OfflineBookRecord>(path.join(booksDirectory, fileName)),
    )
    .filter((record): record is OfflineBookRecord => Boolean(record?.book))
    .filter((record) => {
      try {
        const bookId = bookIdFrom(record.book);
        return fs.existsSync(path.join(downloadsDirectory, `${bookId}.mp3`));
      } catch {
        return false;
      }
    })
    .map((record) => record.book);
}

export function loadOfflinePlaybackMetadata(consumableId: string): unknown {
  ensureDirectories();
  const metadata = readJson<unknown>(
    playbackMetadataPath(safeIdentifier(consumableId, "consumable ID")),
  );
  if (!metadata) throw new Error("Offline playback metadata not found");
  return metadata;
}

export function loadOfflineBookDetails(consumableId: string): unknown {
  ensureDirectories();
  const details = readJson<unknown>(
    bookDetailsPath(safeIdentifier(consumableId, "consumable ID")),
  );
  if (!details) throw new Error("Offline book details not found");
  return details;
}

export function removeOfflineMetadata(bookIdValue: string): void {
  ensureDirectories();
  const bookId = safeIdentifier(bookIdValue, "audiobook ID");
  const recordPath = bookRecordPath(bookId);
  const record = readJson<OfflineBookRecord>(recordPath);

  if (record?.book?.book?.consumableId) {
    const consumableId = safeIdentifier(
      record.book.book.consumableId,
      "consumable ID",
    );
    for (const filePath of [
      playbackMetadataPath(consumableId),
      bookDetailsPath(consumableId),
    ]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  if (fs.existsSync(recordPath)) fs.unlinkSync(recordPath);
  const coverPath = cachedCoverPath(bookId);
  if (coverPath && fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
}
