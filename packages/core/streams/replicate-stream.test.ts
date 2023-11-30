import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ReplicateStream,
  StreamingTextResponse,
  experimental_StreamData,
} from '.';
import { replicateTextChunks } from '../tests/snapshots/replicate';
import { createClient } from '../tests/utils/mock-client';

const url = 'http://localhost/';

const encoder = new TextEncoder();

const server = setupServer(
  http.get(url, () => {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of replicateTextChunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    });

    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
);

describe('ReplicateStream', () => {
  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  function readAllChunks(response: Response) {
    return createClient(response).readAll();
  }

  it('should be able to parse SSE and receive the streamed response', async () => {
    // Note: this only tests the streaming response from Replicate, not the framework invocation.

    const stream = await ReplicateStream(
      {
        id: 'fake',
        status: 'processing',
        version: 'fake',
        input: {},
        source: 'api',
        created_at: 'fake',
        urls: { get: '', cancel: '', stream: url },
      },
      undefined,
    );

    const response = new StreamingTextResponse(stream);

    expect(await readAllChunks(response)).toEqual([' Hello,', ' world', '.']);
  });

  describe('StreamData protocol', () => {
    it('should send text', async () => {
      const data = new experimental_StreamData();

      const stream = await ReplicateStream(
        {
          id: 'fake',
          status: 'processing',
          version: 'fake',
          input: {},
          source: 'api',
          created_at: 'fake',
          urls: { get: '', cancel: '', stream: url },
        },
        {
          onFinal() {
            data.close();
          },
          experimental_streamData: true,
        },
      );

      const response = new StreamingTextResponse(stream, {}, data);

      expect(await readAllChunks(response)).toEqual([
        '0:" Hello,"\n',
        '0:" world"\n',
        '0:"."\n',
      ]);
    });

    it('should send text and data', async () => {
      const data = new experimental_StreamData();

      data.append({ t1: 'v1' });

      const stream = await ReplicateStream(
        {
          id: 'fake',
          status: 'processing',
          version: 'fake',
          input: {},
          source: 'api',
          created_at: 'fake',
          urls: { get: '', cancel: '', stream: url },
        },
        {
          onFinal() {
            data.close();
          },
          experimental_streamData: true,
        },
      );

      const response = new StreamingTextResponse(stream, {}, data);

      expect(await readAllChunks(response)).toEqual([
        '2:[{"t1":"v1"}]\n',
        '0:" Hello,"\n',
        '0:" world"\n',
        '0:"."\n',
      ]);
    });
  });
});
