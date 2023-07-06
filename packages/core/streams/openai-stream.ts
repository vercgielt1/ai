import { Message } from '../shared/types'
import {
  AIStream,
  trimStartOfStreamHelper,
  type AIStreamCallbacks,
  FunctionCallPayload
} from './ai-stream'

function parseOpenAIStream(): (data: string) => string | void {
  const trimStartOfStream = trimStartOfStreamHelper()
  return data => {
    // TODO: Needs a type
    const json = JSON.parse(data)

    /*
       If the response is a function call, the first streaming chunk from OpenAI returns the name of the function like so

          {
            ...
            "choices": [{
              "index": 0,
              "delta": {
                "role": "assistant",
                "content": null,
                "function_call": {
                  "name": "get_current_weather",
                  "arguments": ""
                }
              },
              "finish_reason": null
            }]
          }

       Then, it begins streaming the arguments for the function call.
       The second chunk looks like:

          {
            ...
            "choices": [{
              "index": 0,
              "delta": {
                "function_call": {
                  "arguments": "{\n"
                }
              },
              "finish_reason": null
            }]
          }

        Third chunk:

          {
            ...
            "choices": [{
              "index": 0,
              "delta": {
                "function_call": {
                  "arguments": "\"location"
                }
              },
              "finish_reason": null
            }]
          }

        ...

        Finally, the last chunk has a `finish_reason` of `function_call`:

          {
            ...
            "choices": [{
              "index": 0,
              "delta": {},
              "finish_reason": "function_call"
            }]
          }


        With the implementation below, the client will end up getting a
        response like the one below streamed to them whenever a function call
        response is returned:

          {
            "function_call": {
              "name": "get_current_weather",
              "arguments": "{\"location\": \"San Francisco, CA\", \"format\": \"celsius\"}
            }
          }
     */
    if (json.choices[0]?.delta?.function_call?.name) {
      return `{"function_call": {"name": "${json.choices[0]?.delta?.function_call.name}", "arguments": "`
    } else if (json.choices[0]?.delta?.function_call?.arguments) {
      const argumentChunk: string =
        json.choices[0].delta.function_call.arguments

      let escapedPartialJson = argumentChunk
        .replace(/\\/g, '\\\\') // Replace backslashes first to prevent double escaping
        .replace(/\//g, '\\/') // Escape slashes
        .replace(/"/g, '\\"') // Escape double quotes
        .replace(/\n/g, '\\n') // Escape new lines
        .replace(/\r/g, '\\r') // Escape carriage returns
        .replace(/\t/g, '\\t') // Escape tabs
        .replace(/\f/g, '\\f') // Escape form feeds

      return `${escapedPartialJson}`
    } else if (json.choices[0]?.finish_reason === 'function_call') {
      return '"}}'
    }

    // this can be used for either chat or completion models
    const text = trimStartOfStream(
      json.choices[0]?.delta?.content ?? json.choices[0]?.text ?? ''
    )

    return text
  }
}
export function OpenAIStream(
  res: Response,
  cb?: AIStreamCallbacks
): ReadableStream {
  if (cb && cb.onFunctionCall) {
    console.log('Creating function call transformer')
    const functionCallTransformer = createFunctionCallTransformer(cb)
    return AIStream(res, parseOpenAIStream(), cb).pipeThrough(
      functionCallTransformer
    )
  } else {
    console.log('default ai stream')
    return AIStream(res, parseOpenAIStream(), cb)
  }
}

function createFunctionCallTransformer(
  callbacks: AIStreamCallbacks
): TransformStream<string, Uint8Array> {
  const textEncoder = new TextEncoder()
  let isFirstChunk = true
  let aggregatedResponse = ''
  let isFunctionStreamingIn = false
  let newMessages: Message[] = []

  return new TransformStream({
    async transform(chunk, controller): Promise<void> {
      // @ts-expect-error
      const message = new TextDecoder().decode(chunk)

      if (isFirstChunk) {
        if (message.startsWith('{"function_call":')) {
          isFunctionStreamingIn = true

          // Wait for the entire function call to finish
          aggregatedResponse += message

          console.log('Function call detected')
        } else {
          // Continue streaming
          controller.enqueue(textEncoder.encode(message))
        }

        isFirstChunk = false
      } else if (!isFunctionStreamingIn) {
        // Continue streaming as normal
        controller.enqueue(textEncoder.encode(message))
      } else if (
        !isFirstChunk &&
        callbacks.onFunctionCall &&
        isFunctionStreamingIn
      ) {
        aggregatedResponse += message
        console.log('Aggregated response', aggregatedResponse)
        // function is done streaming
        if (message.endsWith('"}}')) {
          isFunctionStreamingIn = false
          console.log('Function call complete')
          const payload = JSON.parse(aggregatedResponse)
          // { function_call: { name: 'get_current_weather', arguments: '{"location": "San Francisco, CA", "format": "celsius"}' }
          const response = await callbacks.onFunctionCall(
            payload.function_call,
            newMessages
          )

          // What to do with response?

      }
    }
  })
}
