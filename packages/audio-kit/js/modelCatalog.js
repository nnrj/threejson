// Pinned upstream bytes. Importing this catalog never downloads anything.
const modelBase = "https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/a0d5c6a264c0ef92d70d8661d8cc502d79627cd6/";
const runtimeBase = "https://huggingface.co/spaces/k2-fsa/web-assembly-zh-en-tts-zipvoice/resolve/a118980aaa8d985d10e57425c1fdc2301c05f4cc/";
const file = (role, path, bytes, sha256, runtime = false) => ({ role, path, bytes, sha256, url: (runtime ? runtimeBase : modelBase) + path, runtime });
const melo = {
  id: "melo-zh-en", version: "a0d5c6a-int8-sherpa-a118980", adapter: "threejson-melo-wasm-v1", license: "MIT (MeloTTS); Apache-2.0 (sherpa-onnx)",
  title: "MeloTTS 中文 · 本地配音（预览）", languages: ["zh-CN", "en"], output: "pcm", sampleRate: 44100,
  description: "单音色，中英混读受词典覆盖影响。首次配音需约 71 MiB 资源并缓存；运行需要较多内存。仅在主动播放/导出配音或手动下载时获取，不等同于专业配音质量。",
  source: "https://github.com/myshell-ai/MeloTTS", runtimeSource: "https://github.com/k2-fsa/sherpa-onnx",
  files: [
    file("model", "model.int8.onnx", 53517430, "f085f5079e05f039b800aeb542f5253c26a303211b0c6465d0d9387977855a63"),
    file("tokens", "tokens.txt", 655, "d18664a7e12bd7ea1022ddaf951e534e136815016c5a809d6b64156bffb4369d"),
    file("lexicon", "lexicon.txt", 6837671, "7236884b02435ac5d10cf69b4be40a61b45aa676b5300f0e412f185748fee528"),
    file("date", "date.fst", 59154, "eb8aa079ae3cb81d8f4404992f39d61a0cb990947512b5b8d1e54d1f6980e718"),
    file("number", "number.fst", 64482, "743f402181fcfebf76cc2f0546b71fa26476e626fbe4e460fb7b4c3a7a8bd5bd"),
    file("phone", "phone.fst", 88630, "1ac2b6fa56b1442320c4de7db08353bab8963a2b57f365eebcdd3a2d3562f8d7"),
    file("heteronym", "new_heteronym.fst", 21974, "ca14b2127e27baa571664e4bb791e143e7425f56a6bc29db08d74f97e6aa4e29"),
    file("license", "LICENSE", 1053, "88a50e5a02bbc2a5c2f084dc19da751aa97b1690f5fda76cd8005c8634d1ca70"),
    file("runtimeJs", "sherpa-onnx-wasm-main-tts.js", 111298, "b8f1d2f26349561e8225a93a6b0ae9c11e4d9e9cd2df44a51fab960d90ce1a04", true),
    file("runtimeApi", "sherpa-onnx-tts.js", 33227, "91bb4b3095ad4a449bb99518b15b4b31659886d808fd16656b6dce634405fcf1", true),
    file("runtimeWasm", "sherpa-onnx-wasm-main-tts.wasm", 13473435, "d60db5247fa13e92ad291f8cb5cfe2f6823934c0fa430b177724929a587ab9fb", true)
  ]
};
export function getBuiltinAudioModels() { return [structuredClone(melo)]; }
