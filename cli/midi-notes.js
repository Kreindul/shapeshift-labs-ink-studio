/* Read key attacks and releases from PPQ Standard MIDI Files. */
const fs=require('node:fs');
const maxBytes=8*1024*1024, maxNotes=16384;
const requireValid=(value,message)=>{if (!value) throw new RangeError(message);};

function decode(data) {
  requireValid(Buffer.isBuffer(data) && data.length>=14 && data.length<=maxBytes &&
    data.toString('ascii',0,4)==='MThd','Expected a bounded Standard MIDI File');
  const header=data.readUInt32BE(4), format=data.readUInt16BE(8), count=data.readUInt16BE(10), ppq=data.readUInt16BE(12);
  requireValid(header>=6 && 8+header<=data.length && [0,1].includes(format) && count>=1 && count<=256 &&
    (format!==0 || count===1) && ppq>0 && ppq<32768,'Use MIDI format 0 or 1 with a PPQ division');
  let position=8+header, chunks=0, track=0, messages=0;
  const notes=[];
  while (track<count) {
    requireValid(position+8<=data.length && ++chunks<=512,'Truncated MIDI chunk table');
    const name=data.toString('ascii',position,position+4), length=data.readUInt32BE(position+4);
    position+=8;
    const end=position+length;
    requireValid(end<=data.length,'MIDI track extends past the file');
    if (name!=='MTrk') {position=end;continue;}
    let tick=0, running;
    const active=new Map();
    const byte=()=>{
      requireValid(position<end,'Truncated MIDI message');
      return data[position++];
    };
    const variable=()=>{
      let value=0;
      for (let i=0;i<4;i++) {
        const b=byte();
        value=value*128+(b&127);
        if (!(b&128)) return value;
      }
      throw new RangeError('Invalid MIDI variable-length value');
    };
    const parameter=()=>{
      const b=byte();
      requireValid(b<128,'MIDI channel parameters need seven-bit data');
      return b;
    };
    while (position<end) {
      requireValid(++messages<=1e6,'MIDI file exceeds its message budget');
      tick+=variable();
      const next=byte(), status=next>=128 ? next : running;
      requireValid(status!==undefined,'MIDI running status has no channel message');
      if (next<128) position--;
      if (status>=128 && status<240) {
        running=status;
        const type=status>>4, channel=(status&15)+1, pitch=parameter();
        const velocity=type===12 || type===13 ? undefined : parameter();
        if (type!==8 && type!==9) continue;
        const key=channel*128+pitch;
        if (type===9 && velocity) {
          requireValid(notes.length<maxNotes,'MIDI file exceeds its note budget');
          const row={track,channel,pitch,beat:tick/ppq,velocity:velocity/127};
          notes.push(row);
          const queue=active.get(key) ?? {rows:[],read:0};
          queue.rows.push([row,tick]);
          active.set(key,queue);
        } else {
          const queue=active.get(key);
          if (!queue) continue;
          const [row,start]=queue.rows[queue.read++];
          if (tick>start) row.durationBeats=(tick-start)/ppq;
          if (queue.read===queue.rows.length) active.delete(key);
        }
        continue;
      }
      running=undefined;
      requireValid([240,247,255].includes(status),'Unsupported MIDI system message');
      const type=status===255 ? byte() : null, size=variable();
      requireValid(position+size<=end,'Truncated MIDI system or meta event');
      if (type===47) {
        requireValid(size===0,'Invalid MIDI end of track');
        position=end;
        break;
      }
      position+=size;
    }
    position=end;
    track++;
  }
  return {notes:notes.sort((a,b)=>a.beat-b.beat),ppq,format,tracks:count};
}
function read(file) {
  requireValid(fs.statSync(file).size<=maxBytes,'MIDI file exceeds its byte budget');
  return decode(fs.readFileSync(file));
}
module.exports={decode,read};
