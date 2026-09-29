/** Short PCM blocks scheduled on the WebAudio clock, never an onended chain. */
export function createPcmPlayback(mixer, options = {}) {
  const Context = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error("WebAudio playback is unavailable.");
  const context = options.context || new Context({ sampleRate: mixer.sampleRate });
  const nodes = new Set(); let playing = false, disposed = false, timer, origin = 0, offset = 0, cursor = 0, rate = 1, duration = mixer.duration, generation = 0;
  const current = () => playing ? Math.min(duration, offset + (context.currentTime - origin) * rate) : offset;
  const stop = () => { offset = current(); playing = false; generation++;clearTimeout(timer);for(const node of nodes){node.onended=null;try{node.stop();}catch{}node.disconnect();}nodes.clear(); };
  function schedule() {
    if (!playing || disposed) return;
    try {
      const time = context.currentTime;
      while (origin + cursor / mixer.sampleRate / rate < time + .6 && offset + cursor / mixer.sampleRate < duration) {
        const count = Math.min(Math.ceil(.25*mixer.sampleRate), Math.ceil((duration-offset)*mixer.sampleRate)-cursor);
        const pcm = mixer.render(Math.round(offset*mixer.sampleRate)+cursor,count);
        const buffer=context.createBuffer(pcm.channels.length,count,mixer.sampleRate);pcm.channels.forEach((channel,index)=>buffer.copyToChannel(channel,index));
        const node=context.createBufferSource();node.buffer=buffer;node.playbackRate.value=rate;node.connect(context.destination);nodes.add(node);node.onended=()=>{nodes.delete(node);node.disconnect();};node.start(origin+cursor/mixer.sampleRate/rate);cursor+=count;
      }
      if(current()>=duration){stop();options.onEnded?.();return;}
      timer=setTimeout(schedule,30);
    }catch(error){stop();options.onError?.(error);}
  }
  return {
    get time(){return current();},get playing(){return playing;},
    async play(at=offset, settings={}){
      if(disposed)throw new Error("Audio playback is disposed.");
      stop();const revision=generation;
      duration=settings.duration??options.duration??mixer.duration;rate=settings.rate??1;
      if(!Number.isFinite(at)||at<0||!Number.isFinite(duration)||duration<=0||!Number.isFinite(rate)||rate<=0)throw new RangeError("Invalid audio playback range/rate.");
      await context.resume();if(disposed||revision!==generation)return;
      offset=Math.min(at,duration);origin=context.currentTime;cursor=0;playing=true;schedule();
    },
    pause:stop,
    dispose(){if(disposed)return;stop();disposed=true;if(!options.context)void context.close();}
  };
}
