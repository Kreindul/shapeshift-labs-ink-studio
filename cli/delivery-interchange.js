/* Sample-addressed cue sheets and a portable premaster timeline. */
function editorialTimeline({title,sampleRate,frames,timeReference,stems,cues}) {
  const rt=value=>({OTIO_SCHEMA:'RationalTime.1',rate:sampleRate,value});
  const range=(start,duration)=>({OTIO_SCHEMA:'TimeRange.1',start_time:rt(start),duration:rt(duration)});
  const item=(name,source_range=null)=>({name,metadata:{},source_range,effects:[],markers:[],enabled:true,color:null});
  const origin=Number(timeReference);
  return {OTIO_SCHEMA:'Timeline.1',name:title,metadata:{ink:{timeReference,sampleRate}},
    global_start_time:Number.isSafeInteger(origin) ? rt(origin) : null,
    tracks:{...item('Premaster stems'),OTIO_SCHEMA:'Stack.1',
      markers:cues.map(cue=>({OTIO_SCHEMA:'Marker.2',name:cue.label,color:cue.kind==='authored' ? 'CYAN' : 'WHITE',
        comment:cue.role ?? '',metadata:{ink:cue},marked_range:range(cue.offsetSample,cue.durationSamples)})),
      children:Object.entries(stems).map(([role,file])=>({
        ...item(role),OTIO_SCHEMA:'Track.1',kind:'Audio',children:[{
          ...item(role,range(0,frames)),OTIO_SCHEMA:'Clip.1',media_reference:{
            OTIO_SCHEMA:'ExternalReference.1',metadata:{},name:role,available_range:range(0,frames),
            available_image_bounds:null,target_url:file
          }
        }]
      }))
    }
  };
}
const headings=['id','label','role','kind','source','fromSample','toSample','offsetSample','durationSamples',
  'pictureFrame','timeReference'];
function cueCSV(cues) {
  const cell=value=>{
    if (value==null) return '';
    if (typeof value==='number') return String(value);
    const string=String(value);
    const safe=/^\s*[=+\-@]/.test(string) ? "'"+string : string;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  return [headings.join(','),...cues.map(row=>headings.map(key=>cell(row[key])).join(','))].join('\r\n')+'\r\n';
}
module.exports={editorialTimeline,cueCSV};
