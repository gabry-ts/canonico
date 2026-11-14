import json, base64, os, urllib.request, sys
env = dict(l.strip().split('=', 1) for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.env')) if '=' in l and not l.startswith('#'))
key = env['ELEVENLABS_API_KEY'].strip().strip('"\'')
voice, name = sys.argv[1], sys.argv[2]
speed = float(sys.argv[3]) if len(sys.argv) > 3 else None
text = open('script_tagged.txt').read().strip()
vs = {"stability": 0.5, "similarity_boost": 0.75}
if speed: vs["speed"] = speed
body = {"text": text, "model_id": "eleven_v4", "voice_settings": vs}
def call(fmt):
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format={fmt}',
        data=json.dumps(body).encode(), headers={'xi-api-key': key, 'Content-Type': 'application/json', 'User-Agent': 'video-tool/1.0'})
    return json.load(urllib.request.urlopen(req, timeout=180))
try:
    try: r = call('mp3_44100_192')
    except urllib.error.HTTPError as e:
        print(name, 'fmt192 failed', e.code, e.read()[:200]); r = call('mp3_44100_128')
except urllib.error.HTTPError as e:
    print(name, 'HTTP', e.code, e.read()[:500]); sys.exit(1)
open(f'voice_{name}.mp3', 'wb').write(base64.b64decode(r['audio_base64']))
al = r.get('alignment') or r.get('normalized_alignment')
json.dump({k: v for k, v in r.items() if k != 'audio_base64'}, open(f'align_{name}.json', 'w'))
if not al: print(name, 'NO ALIGNMENT; keys', list(r.keys())); sys.exit(2)
chars = ''.join(al['characters']).lower(); st = al['character_start_times_seconds']; en = al['character_end_times_seconds']
order = [("ask","a new consultant"),("asks","asks the company"),("how","how long"),("ans1","four weeks"),("wrong","wrong"),("changed","the target changed"),
 ("five","five"),("final","and the final report"),("three1","three to four"),("ticket","she opens"),("waits","and waits"),("eng","an engineer"),("dig","dig through"),
 ("s2","next monday"),("withc","with canonico"),("giulia","giulia"),("sees","sees what"),("binding","the binding answer"),("fromfinal","from the final report"),
 ("source","with its source"),("date","and date"),("four","the four versions"),("old","and the old"),("active","still active"),("retire","she retires"),
 ("again","the consultant asks again"),("ans2","three to four weeks"),("noticket","no ticket"),("noeng","no engineer"),("s3","memory tools"),
 ("devs","for developers"),("can","canonico is built"),("people","the people"),("know","know")]
cues, cur = {}, 0
for k, p in order:
    i = chars.find(p, cur)
    if i < 0: print(name, 'MISSING', k, p); continue
    cues[k] = round(st[i], 2); cur = i + len(p)
cues['voice_end'] = round(en[-1], 2); cues['end'] = round(en[-1] + 1.5, 2)
open(f'cues_{name}.js', 'w').write('window.CUES = ' + json.dumps(cues) + ';\n')
print(name, 'tags in alignment:', '[' in chars, '|', json.dumps(cues))
