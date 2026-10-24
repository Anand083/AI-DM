import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertSafeKey, type StorageProvider, type StoredFile } from "./types";

type SendLike = { send(command: unknown): Promise<unknown> };

/** Stores files in an S3 bucket. Not used until the platform runs on AWS (plan Step 33). */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private readonly client: SendLike;

  constructor(
    private readonly bucket: string,
    region: string,
    client?: SendLike,
  ) {
    this.client = client ?? new S3Client({ region });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredFile | null> {
    assertSafeKey(key);
    try {
      const result = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as {
        Body?: { transformToByteArray(): Promise<Uint8Array> };
        ContentType?: string;
      };
      if (!result.Body) return null;
      return {
        bytes: Buffer.from(await result.Body.transformToByteArray()),
        contentType: result.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
