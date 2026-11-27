"""Listening: Whisper base turns a sound into timed phrases, run in the built-in voice's own runtime.

The engine never imports numpy or onnxruntime. The whole of Whisper (log-mel, tokenizer, greedy decoding under the
timestamp rules, word times from the alignment heads, phrase grouping) is the script WORKER, run by the runtime's
Python with -c, its arguments as JSON on stdin and its answer as one JSON line on stdout. The model is the
multilingual base export fetched from the Hugging Face hub at one pinned revision, each file checked against its
pinned size and SHA-256.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

from app.services import voice_runtime

NAME = "Whisper base"
REPO = "onnx-community/whisper-base"
REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925"
# path in the repository -> (sha256, exact size); the hashes are formcut's pins, the sizes the hub's at this revision
FILES = {
    "config.json": ("f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b", 2243),
    "generation_config.json": ("61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0", 3832),
    "tokenizer.json": ("27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566", 2480466),
    "onnx/encoder_model_quantized.onnx": ("5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46", 23201314),
    "onnx/decoder_model_merged_quantized.onnx": ("fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b", 53693315),
}
RATE = 16000
BLOCK = 1 << 20
MIN_TIMEOUT = 300
MAX_TIMEOUT = 7200
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
_HEX = re.compile(r"^[0-9a-f]{64}$")
_LANG_TOKEN = re.compile(r"^<\|([a-z]{2,3})\|>$")

# Ported from formcut's transcribe.py. Reads the WAV with the wave module, decodes 30 s windows seeking by the last
# complete timestamp pair as Whisper does, and groups the word times into short phrases.
WORKER = r'''
import itertools,json,math,statistics,sys,wave
from pathlib import Path
import numpy as np
import onnxruntime as ort

SAMPLE_RATE=16000;N_FFT=400;HOP=160
WINDOW_SAMPLES=30*SAMPLE_RATE;FRAMES=WINDOW_SAMPLES//HOP;FRAME_SECONDS=HOP/SAMPLE_RATE
MAX_WORDS=7;MAX_CHARS=42;MAX_PHRASE=3.5;MAX_GAP=0.7
ENDS=".!?。！？"

def mel_filters(n_mels):
    def to_mel(f):
        f=np.asarray(f,np.float64)
        return np.where(f>=1000.0,15.0+np.log(np.maximum(f,1e-9)/1000.0)/(math.log(6.4)/27.0),f/200.0*3)
    def to_hz(m):
        m=np.asarray(m,np.float64)
        return np.where(m>=15.0,1000.0*np.exp((math.log(6.4)/27.0)*(m-15.0)),200.0*m/3)
    fft_freqs=np.linspace(0,SAMPLE_RATE/2,1+N_FFT//2)
    points=to_hz(np.linspace(to_mel(0.0),to_mel(SAMPLE_RATE/2),n_mels+2))
    diff=np.diff(points)
    ramps=points[:,None]-fft_freqs[None,:]
    weights=np.maximum(0,np.minimum(-ramps[:-2]/diff[:-1,None],ramps[2:]/diff[1:,None]))
    weights*=(2.0/(points[2:n_mels+2]-points[:n_mels]))[:,None]
    return weights.astype(np.float32)

_window=np.hanning(N_FFT+1)[:-1].astype(np.float32)

def log_mel(audio,filters):
    padded=np.zeros(WINDOW_SAMPLES,np.float32)
    padded[:min(len(audio),WINDOW_SAMPLES)]=audio[:WINDOW_SAMPLES]
    padded=np.pad(padded,N_FFT//2,mode="reflect")
    frames=np.lib.stride_tricks.sliding_window_view(padded,N_FFT)[::HOP]
    spectrum=np.fft.rfft(frames*_window,axis=1)
    magnitudes=(spectrum.real**2+spectrum.imag**2)[:-1].T.astype(np.float32)
    log_spec=np.log10(np.maximum(filters@magnitudes,1e-10))
    log_spec=np.maximum(log_spec,log_spec.max()-8.0)
    return ((log_spec+4.0)/4.0).astype(np.float32)

class Tokenizer:
    def __init__(self,path):
        data=json.loads(path.read_text(encoding="utf-8"))
        self.id_to_token={v:k for k,v in data["model"]["vocab"].items()}
        self.special={}
        for entry in data.get("added_tokens",[]):
            self.id_to_token[entry["id"]]=entry["content"]
            self.special[entry["content"]]=entry["id"]
        printable=list(range(ord("!"),ord("~")+1))+list(range(0xA1,0xAC+1))+list(range(0xAE,0xFF+1))
        mapped=list(printable);extra=0
        for byte in range(256):
            if byte not in printable:
                printable.append(byte);mapped.append(256+extra);extra+=1
        self.byte_of={chr(m):b for b,m in zip(printable,mapped)}
        self.eot=self.special["<|endoftext|>"]
        self.sot=self.special["<|startoftranscript|>"]
        self.no_timestamps=self.special["<|notimestamps|>"]
        self.timestamp_begin=self.no_timestamps+1
        self.no_speech=self.special.get("<|nospeech|>",self.special.get("<|nocaptions|>"))
        self.transcribe=self.special.get("<|transcribe|>")
        self.languages={k[2:-2]:v for k,v in self.special.items() if len(k)<=7 and k[2:-2].isalpha() and k[2:-2].islower()}
        self.code_of={v:k for k,v in self.languages.items()}
    def text_of(self,ids):
        pieces="".join(self.id_to_token.get(int(i),"") for i in ids if int(i)<self.eot)
        return bytes(self.byte_of.get(ch,63) for ch in pieces).decode("utf-8",errors="replace")

def median_filter(matrix,width=7):
    pad=width//2
    padded=np.pad(matrix,((0,0),(pad,pad)),mode="reflect")
    return np.median(np.lib.stride_tricks.sliding_window_view(padded,width,axis=1),axis=2)

def dtw(cost):
    n,m=cost.shape
    acc=np.full((n+1,m+1),np.inf,np.float64)
    trace=np.zeros((n+1,m+1),np.int8)
    acc[0,0]=0
    for i in range(1,n+1):
        row=cost[i-1].tolist();above=acc[i-1];best=acc[i]
        for j in range(1,m+1):
            c0,c1,c2=above[j-1],above[j],best[j-1]
            if c0<=c1 and c0<=c2:
                best[j]=c0+row[j-1];trace[i,j]=0
            elif c1<=c2:
                best[j]=c1+row[j-1];trace[i,j]=1
            else:
                best[j]=c2+row[j-1];trace[i,j]=2
    i,j=n,m;xs=[];ys=[]
    while i>0 or j>0:
        xs.append(i-1);ys.append(j-1)
        step=trace[i,j]
        if i==0: step=2
        elif j==0: step=1
        if step==0: i,j=i-1,j-1
        elif step==1: i-=1
        else: j-=1
    return np.array(xs[::-1]),np.array(ys[::-1])

class Whisper:
    def __init__(self,folder):
        self.config=json.loads((folder/"config.json").read_text(encoding="utf-8"))
        self.generation=json.loads((folder/"generation_config.json").read_text(encoding="utf-8"))
        self.tokens=Tokenizer(folder/"tokenizer.json")
        options=ort.SessionOptions();options.log_severity_level=3
        cpu=["CPUExecutionProvider"]
        self.encoder=ort.InferenceSession(str(folder/"onnx/encoder_model_quantized.onnx"),options,providers=cpu)
        self.decoder=ort.InferenceSession(str(folder/"onnx/decoder_model_merged_quantized.onnx"),options,providers=cpu)
        self.layers=int(self.config["decoder_layers"])
        self.heads=int(self.config["decoder_attention_heads"])
        self.head_dim=int(self.config["d_model"])//self.heads
        self.filters=mel_filters(int(self.config["num_mel_bins"]))
        self.multilingual=bool(self.generation.get("is_multilingual") or self.generation.get("lang_to_id"))
        available={o.name for o in self.decoder.get_outputs()}
        heads=self.generation.get("alignment_heads") or []
        if not heads or any(layer>=self.layers for layer,_ in heads):
            heads=[[layer,head] for layer in range(self.layers//2,self.layers) for head in range(self.heads)]
        self.alignment=heads
        self.cross_names=[f"cross_attentions.{layer}" for layer in sorted({layer for layer,_ in heads}) if f"cross_attentions.{layer}" in available]
        present={f"present.{n}.{side}.{kind}" for n in range(self.layers) for side in ("decoder","encoder") for kind in ("key","value")}
        self.outputs=["logits",*sorted(present&available),*self.cross_names]
        self.suppress=[int(t) for t in self.generation.get("suppress_tokens",[])]
        self.begin_suppress=[int(t) for t in self.generation.get("begin_suppress_tokens",[])]
    def encode(self,mel):
        return self.encoder.run(["last_hidden_state"],{"input_features":mel[None]})[0]
    def language_of(self,hidden):
        logits,_=self._step(np.array([[self.tokens.sot]],np.int64),hidden,None)
        ids=np.array(sorted(self.tokens.languages.values()))
        return int(ids[np.argmax(logits[-1][ids])])
    def _step(self,tokens,hidden,past):
        feeds={"input_ids":tokens,"encoder_hidden_states":hidden}
        if past is None:
            empty=np.zeros((1,self.heads,0,self.head_dim),np.float32)
            for n in range(self.layers):
                for side in ("decoder","encoder"):
                    feeds[f"past_key_values.{n}.{side}.key"]=empty
                    feeds[f"past_key_values.{n}.{side}.value"]=empty
            feeds["use_cache_branch"]=np.array([False])
        else:
            feeds.update(past);feeds["use_cache_branch"]=np.array([True])
        out=dict(zip(self.outputs,self.decoder.run(self.outputs,feeds)))
        new_past={}
        for n in range(self.layers):
            for kind in ("key","value"):
                new_past[f"past_key_values.{n}.decoder.{kind}"]=out[f"present.{n}.decoder.{kind}"]
                key=f"past_key_values.{n}.encoder.{kind}"
                new_past[key]=out[f"present.{n}.encoder.{kind}"] if past is None else past[key]
        cross=np.concatenate([out[name][0] for name in self.cross_names],axis=0) if self.cross_names else None
        return out["logits"][0],(new_past,cross)
    def decode_window(self,hidden,prompt,max_tokens=224):
        tb,eot=self.tokens.timestamp_begin,self.tokens.eot
        tokens=list(prompt);attention=[];past=None
        current=np.array([tokens],np.int64);no_speech=None
        for _ in range(max_tokens):
            logits,(past,cross)=self._step(current,hidden,past)
            if cross is not None: attention.append(cross)
            row=logits[-1].astype(np.float64)
            if no_speech is None and self.tokens.no_speech is not None:
                probs=np.exp(row-row.max())
                no_speech=float(probs[self.tokens.no_speech]/probs.sum())
            row[self.suppress]=-np.inf
            row[self.tokens.no_timestamps]=-np.inf
            seq=tokens[len(prompt):]
            if not seq:
                row[self.begin_suppress]=-np.inf
                row[:tb]=-np.inf
                row[tb+int(self.generation.get("max_initial_timestamp_index",50))+1:]=-np.inf
            else:
                last_stamp=seq[-1]>=tb
                penultimate_stamp=len(seq)<2 or seq[-2]>=tb
                if last_stamp:
                    if penultimate_stamp: row[tb:]=-np.inf
                    else: row[:eot]=-np.inf
                stamps=[t for t in seq if t>=tb]
                if stamps:
                    row[tb:stamps[-1] if last_stamp and not penultimate_stamp else stamps[-1]+1]=-np.inf
            shift=row.max()
            logprobs=row-(shift+np.log(np.exp(row-shift).sum()))
            stamp_mass=np.log(np.exp(logprobs[tb:]).sum()) if np.isfinite(logprobs[tb:]).any() else -np.inf
            if stamp_mass>logprobs[:tb].max(): row[:tb]=-np.inf
            choice=int(np.argmax(row))
            tokens.append(choice)
            if choice==eot: break
            current=np.array([[choice]],np.int64)
        return tokens[len(prompt):],(np.concatenate(attention,axis=1) if attention else None),no_speech

def word_spans(model,text_tokens,attention,prompt_len,audio_frames):
    if attention is None or not text_tokens: return []
    layer_index={int(name.split(".")[1]):i for i,name in enumerate(model.cross_names)}
    picked=[attention[layer_index[layer]*model.heads+head] for layer,head in model.alignment if layer in layer_index]
    if not picked: return []
    weights=np.stack(picked)[:,prompt_len:prompt_len+len(text_tokens),:max(2,audio_frames//2)]
    weights=(weights-weights.mean(axis=-2,keepdims=True))/np.maximum(weights.std(axis=-2,keepdims=True),1e-9)
    matrix=np.stack([median_filter(w) for w in weights]).mean(axis=0)
    text_indices,time_indices=dtw(-matrix)
    jumps=np.pad(np.diff(text_indices),(1,0),constant_values=1).astype(bool)
    jump_times=time_indices[jumps]*FRAME_SECONDS*2
    window_end=matrix.shape[1]*FRAME_SECONDS*2
    bounds=[];start=None
    for i,token in enumerate(text_tokens):
        if i==0 or model.tokens.id_to_token.get(token,"").startswith("Ġ"):
            if start is not None: bounds.append((start,i))
            start=i
    bounds.append((start or 0,len(text_tokens)))
    out=[]
    for a,b in bounds:
        t0=float(jump_times[min(a,len(jump_times)-1)])
        t1=float(jump_times[b]) if b<len(jump_times) else window_end
        out.append((a,b,t0,max(t0,t1)))
    return out

def tidy(words):
    if not words: return words
    durations=[max(0.0,w["end"]-w["start"]) for w in words]
    ceiling=max(0.6,2*statistics.median(durations))
    for word,duration in zip(words,durations):
        if duration>ceiling: word["end"]=word["start"]+ceiling
        if word["end"]-word["start"]<0.05: word["end"]=word["start"]+0.05
    for earlier,later in itertools.pairwise(words):
        if later["start"]>earlier["start"]: earlier["end"]=min(earlier["end"],later["start"])
    return words

def repetitive(text):
    words=[w for w in text.lower().split() if w]
    if len(words)<4: return False
    for length in (2,3,4):
        seen={}
        for i in range(len(words)-length+1):
            phrase=" ".join(words[i:i+length])
            seen[phrase]=seen.get(phrase,0)+1
            if seen[phrase]>3: return True
    counts={}
    for word in words:
        counts[word]=counts.get(word,0)+1
        if counts[word]>len(words)*0.5 and counts[word]>4: return True
    return False

def spread(text,start,end):
    # no word times: each word gets a share of the segment by its length
    parts=text.split()
    if not parts: return []
    weights=[len(p)+1 for p in parts];total=float(sum(weights));at=start;out=[]
    for part,weight in zip(parts,weights):
        span=(end-start)*weight/total
        out.append({"text":part,"start":at,"end":at+span});at+=span
    return out

def transcribe(model,audio,language):
    tb=model.tokens.timestamp_begin;eot=model.tokens.eot
    total=len(audio)
    whole=float(np.sqrt(np.mean(audio.astype(np.float64)**2))) if total else 0.0
    seek=0;segments=[];lang=None
    while total-seek>=SAMPLE_RATE//10:
        chunk=audio[seek:seek+WINDOW_SAMPLES]
        chunk_seconds=len(chunk)/SAMPLE_RATE
        hidden=model.encode(log_mel(chunk,model.filters))
        audio_frames=min(FRAMES,math.ceil(len(chunk)/HOP))
        if model.multilingual:
            if lang is None:
                lang=model.tokens.languages.get(language) if language else None
                if lang is None: lang=model.language_of(hidden)
            prompt=[model.tokens.sot,lang,model.tokens.transcribe]
        else:
            prompt=[model.tokens.sot]
        tokens,attention,no_speech=model.decode_window(hidden,prompt)
        if tokens and tokens[-1]==eot: tokens=tokens[:-1]
        text_tokens=[t for t in tokens if t<eot]
        offset=seek/SAMPLE_RATE
        if (no_speech is not None and no_speech>0.6) or not text_tokens:
            seek+=WINDOW_SAMPLES;continue
        spans=word_spans(model,text_tokens,attention,len(prompt),audio_frames)
        # each token's index among the text tokens, so a segment knows which word spans are its own
        position=[];count=0
        for t in tokens:
            position.append(count)
            if t<tb: count+=1
        stamp=[t>=tb for t in tokens]
        single_ending=len(tokens)>=2 and not stamp[-2] and stamp[-1]
        consecutive=[i+1 for i in range(len(tokens)-1) if stamp[i] and stamp[i+1]]
        pieces=[]
        if consecutive:
            slices=list(consecutive)
            if single_ending: slices.append(len(tokens))
            last=0
            for cut in slices:
                part=tokens[last:cut]
                if part and part[0]>=tb and part[-1]>=tb:
                    pieces.append(((part[0]-tb)*0.02,(part[-1]-tb)*0.02,position[last],position[cut-1]+(0 if stamp[cut-1] else 1)))
                last=cut
            if single_ending:
                advance=WINDOW_SAMPLES
            else:
                advance=int((tokens[last-1]-tb)*0.02*SAMPLE_RATE)
                if advance<=0: advance=WINDOW_SAMPLES
        else:
            stamps=[t for t in tokens if t>=tb]
            duration=chunk_seconds
            if stamps and stamps[-1]!=tb: duration=(stamps[-1]-tb)*0.02
            first=(stamps[0]-tb)*0.02 if stamps and stamp[0] else 0.0
            pieces.append((first,duration,0,len(text_tokens)))
            advance=WINDOW_SAMPLES
        for start,end,a,b in pieces:
            end=min(end,chunk_seconds)
            text=model.tokens.text_of(text_tokens[a:b]).strip()
            # punctuation alone ("!!!!") is what the model hears in steady noise
            if not any(ch.isalnum() for ch in text) or end<=start or repetitive(text): continue
            region=audio[seek+int(start*SAMPLE_RATE):seek+int(end*SAMPLE_RATE)]
            # a segment heard over silence is the model filling the quiet with a stock phrase
            level=float(np.sqrt(np.mean(region.astype(np.float64)**2))) if len(region) else 0.0
            if whole and level<0.15*whole: continue
            words=[]
            for wa,wb,w0,w1 in spans:
                if wa>=a and wb<=b:
                    word=model.tokens.text_of(text_tokens[wa:wb]).strip()
                    if word: words.append({"text":word,"start":w0,"end":w1})
            if not words: words=spread(text,start,end)
            for word in tidy(words):
                word["start"]=offset+word["start"];word["end"]=offset+word["end"]
            segments.append({"text":text,"start":offset+start,"end":offset+end,"words":words})
        seek+=advance
    return segments,(model.tokens.code_of.get(lang,"") if lang is not None else "")

def split_long(words):
    # a run of text with no spaces (Chinese, Japanese) arrives as one long word: cut it by characters
    out=[]
    for w in words:
        text=w["text"]
        if len(text)<=MAX_CHARS: out.append(w);continue
        n=math.ceil(len(text)/MAX_CHARS);span=(w["end"]-w["start"])/n
        for k in range(n):
            out.append({"text":text[k*MAX_CHARS:(k+1)*MAX_CHARS],"start":w["start"]+k*span,"end":w["start"]+(k+1)*span})
    return out

def fits(group):
    return (len(group)<=MAX_WORDS and len(" ".join(w["text"] for w in group))<=MAX_CHARS
            and (len(group)==1 or group[-1]["end"]-group[0]["start"]<=MAX_PHRASE))

def balance(run):
    # the fewest pieces that fit, cut where the text is split most evenly, so a sentence of nine words is not seven and two
    lengths=[len(w["text"])+1 for w in run];total=float(sum(lengths))
    for n in range(1,len(run)+1):
        groups=[[] for _ in range(n)];at=0.0
        for word,length in zip(run,lengths):
            groups[min(n-1,int((at+length/2)/total*n))].append(word);at+=length
        groups=[g for g in groups if g]
        if all(fits(g) for g in groups): return groups
    return [[w] for w in run]

def phrases(segments):
    words=split_long([w for s in segments for w in s["words"]])
    runs=[];run=[]
    for word in words:
        word={"text":word["text"],"start":word["start"],"end":max(word["end"],word["start"]+0.05)}
        if run and (word["start"]-run[-1]["end"]>MAX_GAP or run[-1]["text"][-1:] in ENDS):
            runs.append(run);run=[]
        run.append(word)
    if run: runs.append(run)
    out=[]
    for run in runs:
        for group in balance(run):
            out.append({"start":round(group[0]["start"],3),"end":round(max(w["end"] for w in group),3),
                        "text":" ".join(w["text"] for w in group)})
    return out

def read_wav(path):
    with wave.open(path,"rb") as sound:
        if sound.getnchannels()!=1 or sound.getsampwidth()!=2 or sound.getframerate()!=SAMPLE_RATE or sound.getcomptype()!="NONE":
            raise SystemExit("The sound is not 16 kHz mono 16-bit PCM.")
        data=sound.readframes(sound.getnframes())
    return np.frombuffer(data,"<i2").astype(np.float32)/32768.0

args=json.load(sys.stdin)
audio=read_wav(args["wav"])
language=args.get("language") or ""
seconds=len(audio)/SAMPLE_RATE
level=float(np.sqrt(np.mean(audio.astype(np.float64)**2))) if len(audio) else 0.0
if len(audio)<SAMPLE_RATE//10 or level<1e-3:
    result={"language":language,"seconds":seconds,"cues":[]}
else:
    model=Whisper(Path(args["folder"]))
    segments,heard=transcribe(model,audio,language)
    cues=phrases(segments)
    # a language guessed from noise means nothing when no words were heard
    result={"language":(heard if cues else "") or language,"seconds":seconds,"cues":cues,"words":bool(model.cross_names)}
sys.stdout.write(json.dumps(result)+"\n")
sys.stdout.flush()
'''

_lock = threading.RLock()
_job: dict | None = None
_cancel = threading.Event()
_busy = threading.Lock()
_languages: dict = {}


class VoiceError(Exception):
    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.status = status


class Cancelled(Exception):
    pass


def listen_dir() -> Path:
    # beside the voice's own models, so removing one never takes the other
    return voice_runtime.folder() / "listen" / "whisper-base"


def _path(name: str) -> Path:
    return listen_dir().joinpath(*name.split("/"))


def _worker_env() -> dict:
    """The runtime's Python gets its own site-packages, never a frozen engine's library path or Python variables."""
    env = dict(os.environ)
    for name in ("PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONEXECUTABLE", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"):
        env.pop(name, None)
    bundle = getattr(sys, "_MEIPASS", None)
    for name in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        original = env.pop(name + "_ORIG", None)
        parts = (original if original is not None else env.get(name, "")).split(os.pathsep)
        kept = [part for part in parts if part and not (bundle and part.startswith(bundle))]
        if kept:
            env[name] = os.pathsep.join(kept)
        else:
            env.pop(name, None)
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _last_line(text: str) -> str:
    last = next((line.strip() for line in reversed((text or "").strip().splitlines()) if line.strip()), "")
    return last[:160]


def _runtime() -> bool:
    try:
        return bool(voice_runtime.status().get("runtime"))
    except Exception:
        return False


def _model_ready() -> bool:
    for name, (_digest, size) in FILES.items():
        path = _path(name)
        try:
            if not path.is_file() or path.stat().st_size != size:
                return False
        except OSError:
            return False
    return True


def _size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                continue
    return total


def _running() -> bool:
    return bool(_job and _job.get("state") == "running")


def job() -> dict | None:
    with _lock:
        return dict(_job) if _job else None


def status() -> dict:
    runtime = _runtime()
    model = _model_ready()
    return {
        "ready": runtime and model,
        "runtime": runtime,
        "model": model,
        "name": NAME,
        "bytes": _size(listen_dir()) if listen_dir().is_dir() else 0,
        "job": job(),
    }


# setup


def _set(**changes) -> None:
    with _lock:
        if _job is not None:
            _job.update(changes)


def _check() -> None:
    if _cancel.is_set():
        raise Cancelled()


class _Redirects(urllib.request.HTTPRedirectHandler):
    """Keeps every hop on HTTPS and remembers the hub's first answer, which carries the LFS hash."""

    def __init__(self) -> None:
        super().__init__()
        self.first: dict = {}

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise urllib.error.URLError("a redirect left HTTPS")
        if not self.first:
            self.first = {key.lower(): value for key, value in headers.items()}
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    if sys.platform == "darwin" and os.path.isfile("/etc/ssl/cert.pem"):
        context.load_verify_locations("/etc/ssl/cert.pem")
    return context


def _etag(*values: str | None) -> str | None:
    for value in values:
        tag = (value or "").strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        tag = tag.strip('"').lower()
        if _HEX.match(tag):
            return tag
    return None


def _download(name: str, done_before: int) -> int:
    digest, size = FILES[name]
    label = name.rsplit("/", 1)[-1]
    target = _path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    redirects = _Redirects()
    opener = urllib.request.build_opener(redirects, urllib.request.HTTPSHandler(context=_context()))
    url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{urllib.parse.quote(name)}"
    request = urllib.request.Request(url, headers={"User-Agent": "FormMorpheus"})
    hasher = hashlib.sha256()
    received = 0
    try:
        with opener.open(request, timeout=60) as response, part.open("wb") as out:
            length = response.headers.get("Content-Length")
            if length is not None and length.strip().isdigit() and int(length) != size:
                raise VoiceError(f"The download of {label} is not the size it should be, so it was not kept. Try again.", 502)
            tag = _etag(redirects.first.get("x-linked-etag"), response.headers.get("X-Linked-ETag"),
                        response.headers.get("ETag"))
            if tag is not None and tag != digest:
                raise VoiceError(f"The download of {label} did not match its checksum, so it was not kept. Try again.", 502)
            while True:
                _check()
                block = response.read(BLOCK)
                if not block:
                    break
                received += len(block)
                if received > size:
                    raise VoiceError(f"The download of {label} is larger than it should be, so it was not kept.", 502)
                out.write(block)
                hasher.update(block)
                _set(done=done_before + received)
        if received != size:
            raise VoiceError(f"The download of {label} is not the size it should be, so it was not kept. Try again.", 502)
        if hasher.hexdigest() != digest:
            raise VoiceError(f"The download of {label} did not match its checksum, so it was not kept. Try again.", 502)
        os.replace(part, target)
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise VoiceError("Could not download the listening model. Check the internet connection and try again. "
                         f"{_last_line(str(getattr(exc, 'reason', exc)))}".strip(), 502)
    finally:
        part.unlink(missing_ok=True)
    return received


def _setup() -> None:
    try:
        listen_dir().mkdir(parents=True, exist_ok=True)
        total = sum(size for _digest, size in FILES.values())
        done = 0
        _set(done=0, total=total)
        for name, (_digest, size) in FILES.items():
            _check()
            path = _path(name)
            if path.is_file() and path.stat().st_size == size:
                done += size
                _set(done=done)
                continue
            path.unlink(missing_ok=True)
            done += _download(name, done)
            _set(done=done)
        with _lock:
            _languages.clear()
        _set(state="done", error="")
    except Cancelled:
        _set(state="cancelled", error="")
    except VoiceError as exc:
        _set(state="failed", error=str(exc))
    except Exception as exc:   # anything unforeseen still ends the job, so the window stops waiting
        _set(state="failed", error=f"Downloading the listening model failed. {_last_line(str(exc))}".strip())


def start_setup() -> dict:
    global _job
    if not _runtime():
        raise VoiceError("Set up the built-in voice first, in the AI Voice card.")
    with _lock:
        if _running():
            raise VoiceError("The listening model is already being downloaded.")
        _cancel.clear()
        _job = {"state": "running", "step": "model", "done": 0, "total": 0, "error": ""}
        threading.Thread(target=_setup, name="listen-setup", daemon=True).start()
        return dict(_job)


def cancel() -> bool:
    with _lock:
        if not _running():
            return False
        _cancel.set()
        return True


def remove() -> bool:
    global _job
    with _lock:
        if _running():
            raise VoiceError("Wait for the download to finish or cancel it, then remove the listening model.")
        _job = None
        _languages.clear()
    top = listen_dir().parent
    if not top.exists():
        return False
    shutil.rmtree(top, ignore_errors=True)
    if top.exists():
        raise VoiceError("Some of the listening model's files could not be removed. Close anything using them and try again.")
    return True


# listening


def _known_languages() -> set[str]:
    """The language codes the tokenizer has a token for, read once per tokenizer file."""
    path = _path("tokenizer.json")
    try:
        stamp = (str(path), path.stat().st_mtime_ns)
    except OSError:
        return set()
    with _lock:
        if _languages.get("stamp") == stamp:
            return set(_languages["codes"])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        codes = {match.group(1) for entry in data.get("added_tokens", [])
                 if (match := _LANG_TOKEN.match(str(entry.get("content", ""))))}
    except (OSError, ValueError, AttributeError):
        codes = set()
    with _lock:
        _languages["stamp"] = stamp
        _languages["codes"] = codes
    return codes


def _language(language: str) -> str:
    """'' for detect, else a code the tokenizer knows; en-US and en_us are read as en."""
    code = (language or "").strip().lower()
    if code in ("", "auto"):
        return ""
    code = re.split(r"[-_]", code, maxsplit=1)[0]
    if code not in _known_languages():
        shown = re.sub(r"[^a-z0-9-]", "", (language or "").strip().lower())[:12]
        raise VoiceError(f"The listening model does not know the language {shown}. Choose another language or let it detect the language.", 422)
    return code


def _seconds(wav: bytes) -> float:
    try:
        with wave.open(io.BytesIO(wav), "rb") as sound:
            if (sound.getnchannels() != 1 or sound.getsampwidth() != 2 or sound.getframerate() != RATE
                    or sound.getcomptype() != "NONE"):
                raise VoiceError("The sound must be a 16 kHz mono 16-bit WAV.", 422)
            return sound.getnframes() / float(RATE)
    except (wave.Error, EOFError, ValueError):
        raise VoiceError("The sound must be a 16 kHz mono 16-bit WAV.", 422)


def _clean(cues: list, seconds: float) -> list[dict]:
    """In order, inside the sound, never overlapping, whatever the worker gave."""
    kept: list[dict] = []
    for cue in cues if isinstance(cues, list) else []:
        try:
            start = max(0.0, min(float(cue["start"]), seconds))
            end = max(0.0, min(float(cue["end"]), seconds))
            text = " ".join(str(cue["text"]).split())
        except (KeyError, TypeError, ValueError):
            continue
        if text and end > start:
            kept.append({"start": start, "end": end, "text": text})
    kept.sort(key=lambda cue: (cue["start"], cue["end"]))
    out: list[dict] = []
    for index, cue in enumerate(kept):
        if out and cue["start"] < out[-1]["end"]:
            cue["start"] = out[-1]["end"]
        if index + 1 < len(kept):
            cue["end"] = min(cue["end"], max(cue["start"], kept[index + 1]["start"]))
        if cue["end"] - cue["start"] < 0.01:
            continue
        out.append({"start": round(cue["start"], 3), "end": round(cue["end"], 3), "text": cue["text"]})
    return out


def transcribe(wav: bytes, language: str) -> dict:
    if not _runtime():
        raise VoiceError("Set up the built-in voice first, in the AI Voice card.")
    if _running():
        raise VoiceError("The listening model is still being downloaded.")
    if not _model_ready():
        raise VoiceError("Download the listening model first.")
    code = _language(language)
    seconds = _seconds(wav)
    if seconds < 0.1:
        return {"language": code, "seconds": round(seconds, 3), "cues": []}
    if not _busy.acquire(blocking=False):
        raise VoiceError("Another sound is being listened to. Wait for it to finish, then try again.")
    try:
        folder = voice_runtime.folder()
        folder.mkdir(parents=True, exist_ok=True)
        handle, name = tempfile.mkstemp(prefix=".listen-", suffix=".wav", dir=folder)
        sound = Path(name)
        try:
            with os.fdopen(handle, "wb") as out:
                out.write(wav)
            args = {"folder": str(listen_dir()), "wav": str(sound), "language": code}
            timeout = min(MAX_TIMEOUT, max(MIN_TIMEOUT, 10 * seconds))
            try:
                done = subprocess.run([str(voice_runtime.runtime_python()), "-c", WORKER], input=json.dumps(args),
                                      capture_output=True, text=True, encoding="utf-8", errors="replace",
                                      timeout=timeout, check=False, creationflags=NO_WINDOW, env=_worker_env())
            except subprocess.TimeoutExpired:
                raise VoiceError("Listening to this sound took too long. Try a shorter part.", 502)
            except OSError as exc:
                raise VoiceError(f"Listening could not start. {_last_line(str(exc))}".strip(), 502)
        finally:
            sound.unlink(missing_ok=True)
    finally:
        _busy.release()
    if done.returncode:
        raise VoiceError(f"Listening to this sound failed. {_last_line(done.stderr)}".strip(), 502)
    try:
        report = json.loads(next(line for line in reversed(done.stdout.splitlines()) if line.startswith("{")))
    except (StopIteration, ValueError):
        raise VoiceError(f"Listening gave back no words. {_last_line(done.stderr)}".strip(), 502)
    heard = str(report.get("language") or code)
    return {"language": heard, "seconds": round(seconds, 3), "cues": _clean(report.get("cues"), seconds)}
