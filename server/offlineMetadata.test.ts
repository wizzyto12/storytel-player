import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import NodeID3 from "node-id3";
import StorytelClient from "./storytelApi";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("persists offline book data and embeds ID3 metadata", async () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "storytel-metadata-test-"),
  );
  const downloadsDirectory = path.join(temporaryDirectory, "Downloads");
  fs.mkdirSync(downloadsDirectory);
  process.env.USER_DATA_PATH = path.join(temporaryDirectory, "user-data");

  const coverServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(onePixelPng);
  });
  await new Promise<void>((resolve) => coverServer.listen(0, resolve));
  const address = coverServer.address();
  assert(address && typeof address !== "string");

  try {
    const offlineMetadata = await import("./offlineMetadata");
    const audioFilePath = path.join(downloadsDirectory, "123.mp3");
    fs.writeFileSync(audioFilePath, Buffer.from([0xff, 0xfb, 0x90, 0x64]));

    const storytelClient = {
      getPlayBookMetaData: async () => ({ formats: [{ type: "abook" }] }),
      getBookDetails: async () => ({
        description: "A cached description",
        language: "bg",
      }),
    } as unknown as StorytelClient;

    const result = await offlineMetadata.persistOfflineMetadata({
      audioFilePath,
      storytelClient,
      force: true,
      book: {
        id: "book-123",
        status: 1,
        book: {
          name: "A Story",
          authorsAsString: "An Author",
          consumableId: "consumable-123",
          largeCover: `http://127.0.0.1:${address.port}/cover.png`,
          category: { title: "Children" },
          language: { isoValue: "bul" },
          series: [{ name: "A Series" }],
          seriesOrder: 2,
        },
        abook: {
          id: "123",
          narratorAsString: "A Narrator",
          publisher: { name: "A Publisher" },
          releaseDate: "2026-07-17",
        },
      },
    });

    assert.equal(result.tagged, true);
    const tags = NodeID3.read(audioFilePath);
    assert.equal(tags.title, "A Story");
    assert.equal(tags.artist, "An Author");
    assert.equal(tags.album, "A Series");
    assert.equal(tags.performerInfo, "A Narrator");
    assert.equal(tags.publisher, "A Publisher");
    const image = tags.image;
    assert(image && typeof image !== "string");
    assert.equal(image.mime, "image/png");

    const offlineBooks = offlineMetadata.loadOfflineBooks(downloadsDirectory);
    assert.equal(offlineBooks.length, 1);
    assert.match(offlineBooks[0].book?.largeCover || "", /^file:/);
    assert.deepEqual(
      offlineMetadata.loadOfflinePlaybackMetadata("consumable-123"),
      { formats: [{ type: "abook" }] },
    );
    assert.deepEqual(
      offlineMetadata.loadOfflineBookDetails("consumable-123"),
      { description: "A cached description", language: "bg" },
    );

    offlineMetadata.removeOfflineMetadata("123");
    assert.equal(offlineMetadata.loadOfflineBooks(downloadsDirectory).length, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      coverServer.close((error) => (error ? reject(error) : resolve())),
    );
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
