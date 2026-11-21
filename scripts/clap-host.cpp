// Offline CLAP worker. Build against the upstream CLAP SDK headers.
#include <clap/clap.h>
#include <dlfcn.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void need(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
constexpr uint32_t magic = 0x314b4e49, blockSize = 256, stateLimit = 4*1024*1024, maxFrames = 8000000;
thread_local bool audioThread = false;

template <class T> T read(std::ifstream &file) {
  T value{};
  need(bool(file.read(reinterpret_cast<char *>(&value), sizeof value)), "Truncated CLAP job");
  return value;
}
template <class T> std::vector<T> readMany(std::ifstream &file, size_t count) {
  std::vector<T> result(count);
  if (count) need(bool(file.read(reinterpret_cast<char *>(result.data()), count*sizeof(T))), "Truncated CLAP job buffer");
  return result;
}
struct Knot { int32_t at; double value; };
struct Lane {
  clap_id id = 0;
  bool linear = false;
  std::vector<Knot> points;
  size_t cursor = 0;
  double last = std::numeric_limits<double>::quiet_NaN();
  double at(int64_t sample) {
    while (cursor+1<points.size() && points[cursor+1].at<=sample) ++cursor;
    const auto &left=points[cursor];
    if (!linear || sample<=left.at || cursor+1==points.size()) return left.value;
    const auto &right=points[cursor+1];
    return left.value+(right.value-left.value)*(sample-left.at)/(right.at-left.at);
  }
};
struct Job {
  uint32_t rate, frames, latency, tail;
  std::vector<Lane> lanes;
  std::vector<char> state;
  std::vector<float> input,key;
  explicit Job(const char *name) {
    std::ifstream file(name,std::ios::binary);
    need(read<uint32_t>(file)==magic,"Unknown CLAP job format");
    rate=read<uint32_t>(file); frames=read<uint32_t>(file);
    const auto inputFrames=read<uint32_t>(file), keyFrames=read<uint32_t>(file), stateBytes=read<uint32_t>(file),
      controls=read<uint32_t>(file);
    latency=read<uint32_t>(file); tail=read<uint32_t>(file);
    need(rate>=8000 && rate<=96000 && frames<=maxFrames && inputFrames<=maxFrames &&
      keyFrames<=maxFrames && stateBytes<=stateLimit && controls<=64,"CLAP job exceeds host bounds");
    for (uint32_t i=0;i<controls;i++) {
      Lane lane;
      lane.id=read<uint32_t>(file);
      lane.linear=read<uint32_t>(file)!=0;
      const auto knots=read<uint32_t>(file);
      need(knots>0 && knots<=2048,"Invalid CLAP parameter lane");
      for (uint32_t n=0;n<knots;n++) {
        const auto at=read<int32_t>(file);
        const auto value=read<double>(file);
        need(std::isfinite(value) && (!n || lane.points.back().at<at),"Invalid CLAP parameter point");
        lane.points.push_back({at,value});
      }
      lanes.push_back(std::move(lane));
    }
    state=readMany<char>(file,stateBytes);
    input=readMany<float>(file,2*size_t(inputFrames));
    key=readMany<float>(file,2*size_t(keyFrames));
    need(file.peek()==std::ifstream::traits_type::eof(),"Unexpected bytes after CLAP job");
  }
};
struct Events {
  std::vector<clap_event_param_value_t> values;
  clap_input_events_t in{this,
    [](const clap_input_events_t *list) {return uint32_t(static_cast<Events *>(list->ctx)->values.size());},
    [](const clap_input_events_t *list, uint32_t index)->const clap_event_header_t * {
      const auto &values=static_cast<Events *>(list->ctx)->values;
      return index<values.size() ? &values[index].header : nullptr;
    }};
  clap_output_events_t out{nullptr,[](const clap_output_events_t *,const clap_event_header_t *) {return true;}};
  void push(uint32_t i,const clap_param_info_t &param,double value) {
    values.push_back({{sizeof(clap_event_param_value_t),i,CLAP_CORE_EVENT_SPACE_ID,CLAP_EVENT_PARAM_VALUE,0},
      param.id,param.cookie,-1,-1,-1,-1,value});
  }
};
struct Host {
  std::atomic<bool> restart{false},callback{false};
  clap_host_t host{CLAP_VERSION,this,"Ink Offline","Shapeshift Labs","","1",
    [](const clap_host_t *,const char *ext)->const void * {
      static const clap_host_thread_check_t thread{
        [](const clap_host_t *) {return !audioThread;},[](const clap_host_t *) {return audioThread;}
      };
      static const clap_host_latency_t latency{[](const clap_host_t *) {}};
      static const clap_host_params_t params{
        [](const clap_host_t *,clap_param_rescan_flags) {},
        [](const clap_host_t *,clap_id,clap_param_clear_flags) {},
        [](const clap_host_t *) {}
      };
      static const clap_host_tail_t tail{[](const clap_host_t *) {}};
      if (!std::strcmp(ext,CLAP_EXT_THREAD_CHECK)) return &thread;
      if (!std::strcmp(ext,CLAP_EXT_LATENCY)) return &latency;
      if (!std::strcmp(ext,CLAP_EXT_PARAMS)) return &params;
      if (!std::strcmp(ext,CLAP_EXT_TAIL)) return &tail;
      return nullptr;
    },
    [](const clap_host_t *h) {static_cast<Host *>(h->host_data)->restart=true;},
    [](const clap_host_t *) {},
    [](const clap_host_t *h) {static_cast<Host *>(h->host_data)->callback=true;}};
};
struct Instance {
  Host host;
  void *module=nullptr;
  const clap_plugin_entry_t *entry=nullptr;
  const clap_plugin_t *plugin=nullptr;
  bool entryReady=false,active=false,processing=false;
  ~Instance() {
    if (processing) {audioThread=true;plugin->stop_processing(plugin);audioThread=false;}
    if (active) plugin->deactivate(plugin);
    if (plugin) plugin->destroy(plugin);
    if (entryReady) entry->deinit();
    if (module) dlclose(module);
  }
  template<class T> const T *extension(const char *id) const {
    return static_cast<const T *>(plugin->get_extension(plugin,id));
  }
  void open(const char *binary,const char *entryPath,const char *id) {
    module=dlopen(binary,RTLD_LOCAL|RTLD_NOW);
    if (!module) throw std::runtime_error(dlerror());
    entry=static_cast<const clap_plugin_entry_t *>(dlsym(module,"clap_entry"));
    need(entry && clap_version_is_compatible(entry->clap_version),"Incompatible CLAP entry");
    entryReady=entry->init(entryPath);
    need(entryReady,"CLAP entry initialization failed");
    const auto *factory=static_cast<const clap_plugin_factory_t *>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
    need(factory,"Missing CLAP plugin factory");
    plugin=factory->create_plugin(factory,&host.host,id);
    need(plugin && plugin->init(plugin),"CLAP plugin ID or initialization failed");
  }
  void start(uint32_t rate) {
    if (const auto *render=extension<clap_plugin_render_t>(CLAP_EXT_RENDER)) {
      need(!render->has_hard_realtime_requirement(plugin) && render->set(plugin,CLAP_RENDER_OFFLINE),
        "Plugin does not support offline processing");
    }
    active=plugin->activate(plugin,rate,1,blockSize);
    need(active,"CLAP activation failed");
    host.restart=false;
  }
  void callback() {
    if (host.callback.exchange(false)) plugin->on_main_thread(plugin);
  }
};

bool loadState(Instance &instance,const std::vector<char> &bytes) {
  const auto *ext=instance.extension<clap_plugin_state_t>(CLAP_EXT_STATE);
  if (bytes.empty()) return true;
  if (!ext) return false;
  struct Cursor {const std::vector<char> &data;size_t at=0;} cursor{bytes};
  const clap_istream_t stream{&cursor,[](const clap_istream_t *s,void *target,uint64_t size)->int64_t {
    auto &c=*static_cast<Cursor *>(s->ctx);
    const auto count=std::min<uint64_t>(size,c.data.size()-c.at);
    if (count) std::memcpy(target,c.data.data()+c.at,count);
    c.at+=count;
    return count;
  }};
  return ext->load(instance.plugin,&stream);
}
void saveState(Instance &instance,const char *file) {
  const auto *ext=instance.extension<clap_plugin_state_t>(CLAP_EXT_STATE);
  need(ext,"CLAP plugin does not expose state");
  std::vector<char> bytes;
  const clap_ostream_t stream{&bytes,[](const clap_ostream_t *s,const void *data,uint64_t size)->int64_t {
    auto &out=*static_cast<std::vector<char> *>(s->ctx);
    if (size>stateLimit-out.size()) return -1;
    if (size) {const auto *first=static_cast<const char *>(data);out.insert(out.end(),first,first+size);}
    return size;
  }};
  need(ext->save(instance.plugin,&stream),"CLAP state save failed");
  std::ofstream out(file,std::ios::binary);
  if (!bytes.empty()) out.write(bytes.data(),bytes.size());
  need(bool(out),"Cannot write CLAP state");
}
using Catalog=std::map<clap_id,clap_param_info_t>;
Catalog parameters(Instance &instance,Job &job,Events &events) {
  Catalog rows;
  const auto *ext=instance.extension<clap_plugin_params_t>(CLAP_EXT_PARAMS);
  if (ext) {
    const auto count=ext->count(instance.plugin);
    need(count<=8192,"CLAP parameter count exceeds the host budget");
    for (uint32_t i=0;i<count;i++) {
      clap_param_info_t info{};
      need(ext->get_info(instance.plugin,i,&info),"Cannot read CLAP parameter");
      if (!(info.flags&CLAP_PARAM_IS_READONLY)) rows.emplace(info.id,info);
    }
  }
  for (auto &lane:job.lanes) {
    need(rows.count(lane.id),"Unknown or read-only CLAP parameter");
    const auto &param=rows.at(lane.id);
    const bool stepped=param.flags&CLAP_PARAM_IS_STEPPED;
    need(lane.points.size()==1 || (param.flags&CLAP_PARAM_IS_AUTOMATABLE),"CLAP parameter does not accept automation");
    for (const auto &point:lane.points) need(point.value>=param.min_value && point.value<=param.max_value &&
      (!stepped || (!lane.linear && std::trunc(point.value)==point.value)),"CLAP parameter is outside its range");
    lane.last=lane.at(0);
    events.push(0,param,lane.last);
  }
  if (!job.lanes.empty()) ext->flush(instance.plugin,&events.in,&events.out);
  events.values.clear();
  instance.callback();
  return rows;
}
uint32_t ports(Instance &instance) {
  const auto *ext=instance.extension<clap_plugin_audio_ports_t>(CLAP_EXT_AUDIO_PORTS);
  const auto *plugin=instance.plugin;
  need(ext && ext->count(plugin,false)==1,"Host requires one CLAP audio output");
  const auto count=ext->count(plugin,true);
  clap_audio_port_info_t input{},output{},key{};
  need((count==1 || count==2) && ext->get(plugin,0,true,&input) && ext->get(plugin,0,false,&output) &&
    input.channel_count==2 && output.channel_count==2,"Host requires stereo main input and output");
  if (count==1) return 0;
  need(ext->get(plugin,1,true,&key) && (key.channel_count==1 || key.channel_count==2),
    "A CLAP key port needs mono or stereo input");
  return key.channel_count;
}

void render(Instance &instance,Job &job,Events &events,const Catalog &params,uint32_t keyChannels,const char *file) {
  std::ofstream out(file,std::ios::binary);
  need(bool(out) && (job.key.empty() || keyChannels),"Invalid CLAP output or sidechain");
  std::array<std::array<float,blockSize>,2> main{},side{},output{};
  float *pMain[]={main[0].data(),main[1].data()}, *pSide[]={side[0].data(),side[1].data()},
    *pOut[]={output[0].data(),output[1].data()};
  clap_audio_buffer_t inputs[2]={{pMain,nullptr,2,0,0},{pSide,nullptr,keyChannels,0,0}}, result{pOut,nullptr,2,0,0};
  const auto frames=uint64_t(job.frames)+job.latency;
  audioThread=true;
  instance.processing=instance.plugin->start_processing(instance.plugin);
  audioThread=false;
  need(instance.processing,"CLAP start processing failed");
  std::vector<float> interleaved;
  interleaved.reserve(blockSize*2);
  for (uint64_t base=0;base<frames;base+=blockSize) {
    const auto count=uint32_t(std::min<uint64_t>(blockSize,frames-base));
    events.values.clear();
    for (uint32_t i=0;i<count;i++) {
      const auto sample=base+i, offset=sample*2;
      for (size_t ch=0;ch<2;ch++) {
        main[ch][i]=offset+ch<job.input.size() ? job.input[offset+ch] : 0;
        side[ch][i]=offset+ch<job.key.size() ? job.key[offset+ch] : 0;
        output[ch][i]=0;
      }
      if (keyChannels==1) side[0][i]=(side[0][i]+side[1][i])*.5f;
      for (auto &lane:job.lanes) if (lane.points.size()>1) {
        const auto value=lane.at(sample);
        if (lane.last!=value) {events.push(i,params.at(lane.id),value);lane.last=value;}
      }
    }
    result.constant_mask=0;
    const clap_process_t process{int64_t(base),count,nullptr,inputs,&result,keyChannels ? 2u : 1u,1,&events.in,&events.out};
    audioThread=true;
    const auto status=instance.plugin->process(instance.plugin,&process);
    audioThread=false;
    instance.callback();
    need(status>=CLAP_PROCESS_CONTINUE && status<=CLAP_PROCESS_SLEEP && !instance.host.restart,
      "CLAP process failed or requested a layout restart");
    interleaved.clear();
    for (uint32_t i=0;i<count;i++) if (base+i>=job.latency) {
      for (size_t ch=0;ch<2;ch++) {
        const float value=output[ch][result.constant_mask&(1u<<ch) ? 0 : i];
        need(std::isfinite(value),"Nonfinite CLAP output");
        interleaved.push_back(value);
      }
    }
    if (!interleaved.empty()) out.write(reinterpret_cast<const char *>(interleaved.data()),interleaved.size()*sizeof(float));
    need(bool(out),"Cannot write CLAP PCM");
  }
}
} // namespace

int main(int argc,char **argv) {
  try {
    need(argc==8,"Use worker mode binary entry-path plugin-id job output metadata");
    const std::string mode=argv[1];
    need(mode=="probe" || mode=="snapshot" || mode=="render","Invalid CLAP worker mode");
    Job job(argv[5]);
    Instance instance;
    instance.open(argv[2],argv[3],argv[4]);
    need(loadState(instance,job.state),"CLAP state could not be restored");
    Events events;
    const auto params=parameters(instance,job,events);
    const auto keyChannels=ports(instance);
    if (mode=="snapshot") {saveState(instance,argv[6]);return 0;}
    instance.start(job.rate);
    instance.callback();
    const auto *delay=instance.extension<clap_plugin_latency_t>(CLAP_EXT_LATENCY);
    const auto *decay=instance.extension<clap_plugin_tail_t>(CLAP_EXT_TAIL);
    const auto latency=delay ? delay->get(instance.plugin) : 0, tail=decay ? decay->get(instance.plugin) : 0;
    need(latency<=job.rate*2 && tail<=job.rate*60,"CLAP declares unsupported latency or tail");
    if (mode=="render") {
      need(job.latency==latency && job.tail==tail,"CLAP render contract changed since planning");
      render(instance,job,events,params,keyChannels,argv[6]);
      audioThread=true;instance.plugin->stop_processing(instance.plugin);audioThread=false;
      instance.processing=false;
      need(!decay || decay->get(instance.plugin)==tail,"CLAP tail changed during the render");
    } else {
      std::ofstream report(argv[7]);
      report << latency << ' ' << tail << ' ' << keyChannels << '\n' << std::setprecision(17);
      for (const auto &[id,param]:params) report << id << ' ' << param.min_value << ' ' << param.max_value << ' '
        << bool(param.flags&CLAP_PARAM_IS_AUTOMATABLE) << ' ' << bool(param.flags&CLAP_PARAM_IS_STEPPED) << '\n';
      need(bool(report),"Cannot write CLAP metadata");
    }
    return 0;
  } catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
