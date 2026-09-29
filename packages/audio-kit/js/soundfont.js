import { compileScore } from "./score.js";

/** Optional SpessaSynth adapter. Host supplies a locally imported bank and library
 * factory; no download or fixed voice/length cap is introduced by this package. */
export function createSoundFontAudioProducer({ soundFont, loadCore, capabilities = {} }) {
  if (!soundFont || typeof loadCore !== "function") throw new TypeError("SoundFont data and a library factory are required.");
  return {
    capabilities: { kind: "score", local: true, output: "pcm", ...capabilities },
    async synthesize(recipe, context = {}) {
      const plan=compileScore(recipe.score), rate=recipe.sampleRate??44100, tail=recipe.tail??1;
      if(!Number.isInteger(rate)||rate<=0||!Number.isFinite(tail)||tail<0)throw new RangeError("Invalid SoundFont sample rate/tail.");
      context.signal?.throwIfAborted();
      const { SoundBankLoader, SpessaSynthProcessor }=await loadCore();
      const bytes=soundFont instanceof Blob ? await soundFont.arrayBuffer() : soundFont;
      const bank=SoundBankLoader.fromArrayBuffer(bytes), synth=new SpessaSynthProcessor(rate,{maxBufferSize:128,eventsEnabled:false,effectsEnabled:true});
      try{
        await synth.processorInitialized;context.signal?.throwIfAborted();synth.soundBankManager.addSoundBank(bank,"threejson");
        const channelIds=new Map();
        for(const track of recipe.score.tracks||[]){
          const channel=channelIds.size;channelIds.set(track.id,channel);
          while(synth.midiChannels.length<=channel)synth.createMIDIChannel();
          const program=track.program??0;if(!Number.isInteger(program)||program<0||program>127)throw new Error("SoundFont program must be 0..127.");
          if(!bank.presets.some(p=>p.program===program&&Boolean(p.isGMGSDrum)===Boolean(track.percussion)))throw new Error(`SoundFont has no requested program ${program} for ${track.id}.`);
          synth.midiChannels[channel].setDrums(Boolean(track.percussion));synth.programChange(channel,program);
          synth.controllerChange(channel,10,Math.round(((track.pan??0)+1)*63.5));
          synth.controllerChange(channel,7,Math.min(127,Math.round((track.gain??1)*127)));
        }
        const events=plan.events.flatMap(note=>{
          if(!Number.isInteger(note.pitch))throw new Error("This MIDI SoundFont adapter requires integer pitches.");
          const channel=channelIds.get(note.trackId);return [{time:note.start,on:true,channel,pitch:note.pitch,velocity:Math.round(note.velocity*127)},{time:note.start+note.duration,on:false,channel,pitch:note.pitch,velocity:0}];
        }).sort((a,b)=>a.time-b.time||Number(a.on)-Number(b.on));
        for(const event of events)synth.processMessage([event.on?0x90:0x80,event.pitch,event.velocity],event.channel,{time:event.time});
        const frames=Math.ceil((plan.duration+tail)*rate),left=new Float32Array(frames),right=new Float32Array(frames);
        for(let offset=0;offset<frames;offset+=128){
          context.signal?.throwIfAborted();synth.process(left,right,offset,Math.min(128,frames-offset));
          if(offset%32768===0){context.onProgress?.(offset/frames);await new Promise(resolve=>setTimeout(resolve,0));}
        }
        context.onProgress?.(1);return{sampleRate:rate,channels:[left,right]};
      }finally{synth.destroySynthProcessor();}
    }
  };
}
