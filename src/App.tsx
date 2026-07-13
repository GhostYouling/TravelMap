import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Camera,
  Check,
  Compass,
  Download,
  FileDown,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  MapPin,
  Pencil,
  Play,
  Plus,
  Trash2,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { api, getAdminToken, saveAdminToken, uploadMedia } from "./api";
import { TravelGlobe } from "./components/TravelGlobe";
import type { AppConfig, MediaItem, Totals, Trip, TripInput } from "./types";

const EMPTY_TOTALS: Totals = { tripCount: 0, mediaCount: 0, totalBytes: 0 };
const EMPTY_CONFIG: AppConfig = { maxUploadMb: 2048, writeProtected: false };

type Modal = "create" | "edit" | "upload" | "token" | null;
type UploadState = { name: string; progress: number; status: "waiting" | "uploading" | "done" | "error"; error?: string };

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDateRange(trip: Trip) {
  const formatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });
  const start = formatter.format(new Date(`${trip.startDate}T00:00:00`));
  if (!trip.endDate || trip.endDate === trip.startDate) return start;
  return `${start} — ${formatter.format(new Date(`${trip.endDate}T00:00:00`))}`;
}

function toTripInput(trip?: Trip): TripInput {
  return trip
    ? {
        title: trip.title,
        locationName: trip.locationName,
        latitude: trip.latitude,
        longitude: trip.longitude,
        startDate: trip.startDate,
        endDate: trip.endDate,
        story: trip.story,
      }
    : {
        title: "",
        locationName: "",
        latitude: 31.2304,
        longitude: 121.4737,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: null,
        story: "",
      };
}

function ModalShell({ title, eyebrow, onClose, children, size = "normal" }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; size?: "normal" | "wide" }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><span className="eyebrow">{eyebrow}</span><h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function TripForm({ initial, busy, onSubmit, onCancel }: { initial?: Trip; busy: boolean; onSubmit: (input: TripInput) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState<TripInput>(() => toTripInput(initial));
  const [error, setError] = useState("");

  function update<K extends keyof TripInput>(key: K, value: TripInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit(values);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }

  return (
    <form className="trip-form" onSubmit={submit}>
      {error && <div className="form-error"><AlertCircle size={16} />{error}</div>}
      <label className="field field-wide"><span>旅程名称</span><input name="title" required maxLength={80} value={values.title} onChange={(e) => update("title", e.target.value)} placeholder="例如：风吹过阿那亚" /></label>
      <label className="field field-wide"><span>地点</span><input name="locationName" required maxLength={100} value={values.locationName} onChange={(e) => update("locationName", e.target.value)} placeholder="国家 / 城市 / 地标" /></label>
      <label className="field"><span>纬度</span><input name="latitude" required type="number" step="0.0001" min="-90" max="90" value={values.latitude} onChange={(e) => update("latitude", Number(e.target.value))} /></label>
      <label className="field"><span>经度</span><input name="longitude" required type="number" step="0.0001" min="-180" max="180" value={values.longitude} onChange={(e) => update("longitude", Number(e.target.value))} /></label>
      <p className="coordinate-note field-wide">可在地图应用里长按地点复制经纬度；纬度在前，经度在后。</p>
      <label className="field"><span>出发日期</span><input name="startDate" required type="date" value={values.startDate} onChange={(e) => update("startDate", e.target.value)} /></label>
      <label className="field"><span>结束日期</span><input name="endDate" type="date" min={values.startDate} value={values.endDate || ""} onChange={(e) => update("endDate", e.target.value || null)} /></label>
      <label className="field field-wide"><span>旅行手记</span><textarea name="story" rows={5} maxLength={4000} value={values.story} onChange={(e) => update("story", e.target.value)} placeholder="风景、气味、某一句话，或者任何不想忘记的细节……" /></label>
      <div className="modal-actions field-wide"><button className="button button-ghost" type="button" onClick={onCancel}>取消</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{initial ? "保存修改" : "点亮这个坐标"}</button></div>
    </form>
  );
}

export function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaPage, setMediaPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadState[]>([]);
  const [toast, setToast] = useState("");
  const [fatalError, setFatalError] = useState("");

  const selectedTrip = useMemo(() => trips.find((trip) => trip.id === selectedId) || null, [trips, selectedId]);
  const selectedIndex = selectedTrip ? trips.findIndex((trip) => trip.id === selectedTrip.id) : -1;

  const refreshTrips = useCallback(async (preferredId?: string) => {
    const result = await api.getTrips();
    setTrips(result.trips);
    setTotals(result.totals);
    setSelectedId((current) => {
      if (preferredId && result.trips.some((trip) => trip.id === preferredId)) return preferredId;
      if (current && result.trips.some((trip) => trip.id === current)) return current;
      return result.trips[0]?.id || null;
    });
  }, []);

  const loadMedia = useCallback(async (tripId: string, page = 1, append = false) => {
    setMediaLoading(true);
    try {
      const result = await api.getMedia(tripId, page);
      setMedia((current) => append ? [...current, ...result.media] : result.media);
      setMediaPage(page);
      setHasMore(result.hasMore);
    } finally {
      setMediaLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([api.getConfig(), refreshTrips()])
      .then(([appConfig]) => setConfig(appConfig))
      .catch((error) => setFatalError(error instanceof Error ? error.message : "无法连接服务"))
      .finally(() => setLoading(false));
  }, [refreshTrips]);

  useEffect(() => {
    if (selectedId) loadMedia(selectedId).catch((error) => setToast(error.message));
    else setMedia([]);
  }, [selectedId, loadMedia]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function needToken(error: unknown) {
    if (error && typeof error === "object" && "status" in error && error.status === 401) {
      setModal("token");
      setToast("请输入管理口令后再试一次");
    }
  }

  async function createTrip(input: TripInput) {
    setBusy(true);
    try {
      const result = await api.createTrip(input);
      await refreshTrips(result.trip.id);
      setModal(null);
      setToast("新的坐标已经点亮");
    } catch (error) {
      needToken(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function updateTrip(input: TripInput) {
    if (!selectedTrip) return;
    setBusy(true);
    try {
      await api.updateTrip(selectedTrip.id, input);
      await refreshTrips(selectedTrip.id);
      setModal(null);
      setToast("旅行手记已更新");
    } catch (error) {
      needToken(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrip() {
    if (!selectedTrip || !window.confirm(`确定删除「${selectedTrip.title}」及其全部媒体吗？此操作无法撤销。`)) return;
    setBusy(true);
    try {
      await api.deleteTrip(selectedTrip.id);
      await refreshTrips();
      setToast("旅程已删除");
    } catch (error) {
      needToken(error);
      setToast(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(fileList: FileList | File[]) {
    if (!selectedTrip) return;
    const supportedExtension = /\.(jpe?g|png|webp|gif|avif|heic|heif|mp4|webm|mov|mkv)$/i;
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || supportedExtension.test(file.name));
    if (!files.length) {
      setToast("请选择照片或视频文件");
      return;
    }
    const tooLarge = files.find((file) => file.size > config.maxUploadMb * 1024 * 1024);
    if (tooLarge) {
      setToast(`${tooLarge.name} 超过 ${config.maxUploadMb} MiB 上限`);
      return;
    }
    setUploadQueue(files.map((file) => ({ name: file.name, progress: 0, status: "waiting" })));
    for (let index = 0; index < files.length; index += 1) {
      setUploadQueue((queue) => queue.map((item, i) => i === index ? { ...item, status: "uploading" } : item));
      try {
        await uploadMedia(selectedTrip.id, files[index], (progress) => {
          setUploadQueue((queue) => queue.map((item, i) => i === index ? { ...item, progress } : item));
        });
        setUploadQueue((queue) => queue.map((item, i) => i === index ? { ...item, progress: 100, status: "done" } : item));
      } catch (error) {
        needToken(error);
        setUploadQueue((queue) => queue.map((item, i) => i === index ? { ...item, status: "error", error: error instanceof Error ? error.message : "上传失败" } : item));
        if (error && typeof error === "object" && "status" in error && error.status === 401) break;
      }
    }
    await Promise.all([refreshTrips(selectedTrip.id), loadMedia(selectedTrip.id)]);
  }

  async function deleteMedia(item: MediaItem) {
    if (!window.confirm(`确定删除「${item.originalName}」吗？`)) return;
    try {
      await api.deleteMedia(item.id);
      setLightbox(null);
      if (selectedTrip) await Promise.all([refreshTrips(selectedTrip.id), loadMedia(selectedTrip.id)]);
      setToast("媒体已删除");
    } catch (error) {
      needToken(error);
      setToast(error instanceof Error ? error.message : "删除失败");
    }
  }

  if (loading) {
    return <main className="loading-screen"><div className="loading-mark"><Compass size={32} /><span /></div><p>正在展开你的旅行地图…</p></main>;
  }

  if (fatalError) {
    return <main className="loading-screen error-screen"><AlertCircle size={36} /><h1>地图暂时没有展开</h1><p>{fatalError}</p><button className="button button-primary" onClick={() => window.location.reload()}>重新连接</button></main>;
  }

  return (
    <div className="app-shell">
      <div className="paper-grain" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="迹屿首页"><span className="brand-seal">迹</span><span><strong>迹屿</strong><small>JIYU · TRAVEL ARCHIVE</small></span></a>
        <div className="topbar-stats" aria-label="旅行统计">
          <span><strong>{totals.tripCount}</strong> 段旅程</span><i />
          <span><strong>{totals.mediaCount}</strong> 个瞬间</span><i />
          <span><strong>{formatBytes(totals.totalBytes)}</strong> 珍藏</span>
        </div>
        <div className="topbar-actions">
          {config.writeProtected && <button className="key-button" type="button" onClick={() => setModal("token")} aria-label="设置管理口令"><KeyRound size={17} /><span>{getAdminToken() ? "已解锁" : "管理"}</span></button>}
          <button className="button button-primary" type="button" onClick={() => setModal("create")} data-testid="create-trip-button"><Plus size={18} />记录新旅程</button>
        </div>
      </header>

      <main className="main-layout" id="top">
        <section className="map-panel" aria-labelledby="map-title">
          <div className="map-copy">
            <span className="eyebrow"><span className="eyebrow-line" />你的世界坐标</span>
            <h1 id="map-title">把走过的地方，<br /><em>留在一颗地球上。</em></h1>
            <p>每一个发光的坐标，都是一段可以重新走进去的时间。</p>
          </div>

          <div className="map-index"><span>MY WORLD</span><strong>{String(totals.tripCount).padStart(2, "0")}</strong><small>PLACES MARKED</small></div>
          <TravelGlobe trips={trips} selectedId={selectedId} onSelect={(trip) => setSelectedId(trip.id)} />

          <div className="trip-ribbon" aria-label="全部旅程">
            {trips.length ? trips.map((trip, index) => (
              <button key={trip.id} type="button" className={trip.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(trip.id)}>
                <span>{String(index + 1).padStart(2, "0")}</span><div><strong>{trip.locationName}</strong><small>{trip.startDate.slice(0, 4)} · {trip.mediaCount} 个瞬间</small></div>
              </button>
            )) : <button type="button" className="ribbon-empty" onClick={() => setModal("create")}><Plus size={17} /><span>添加第一段旅程</span></button>}
          </div>
        </section>

        <aside className="memory-panel" aria-live="polite">
          {selectedTrip ? (
            <>
              <div className="archive-label"><span>TRAVEL ARCHIVE</span><strong>{String(selectedIndex + 1).padStart(2, "0")}<i>/</i>{String(trips.length).padStart(2, "0")}</strong></div>
              <div className="trip-heading">
                <div><span className="location-line"><MapPin size={14} />{selectedTrip.locationName}</span><h2>{selectedTrip.title}</h2></div>
                <div className="trip-actions"><button className="icon-button" type="button" onClick={() => setModal("edit")} aria-label="编辑旅程"><Pencil size={17} /></button><button className="icon-button danger" type="button" onClick={deleteTrip} disabled={busy} aria-label="删除旅程"><Trash2 size={17} /></button></div>
              </div>
              <div className="date-line"><CalendarDays size={15} /><span>{formatDateRange(selectedTrip)}</span><i /></div>
              <p className="trip-story">{selectedTrip.story || "这段旅程还没有写下手记。也许可以从当时的天气开始。"}</p>

              <div className="memory-summary">
                <div><Camera size={16} /><span><strong>{selectedTrip.photoCount}</strong>照片</span></div>
                <div><Video size={16} /><span><strong>{selectedTrip.videoCount}</strong>视频</span></div>
                <div><HardDrive size={16} /><span><strong>{formatBytes(selectedTrip.totalBytes)}</strong>占用</span></div>
              </div>

              <div className="gallery-heading">
                <div><span className="eyebrow">沿途影像</span><h3>{selectedTrip.mediaCount ? `${selectedTrip.mediaCount} 个被留下的瞬间` : "还没有影像"}</h3></div>
                <div className="gallery-actions"><button className="button button-light" type="button" onClick={() => { setUploadQueue([]); setModal("upload"); }}><UploadCloud size={16} />上传</button>{selectedTrip.mediaCount > 0 && <a className="button button-icon-only" href={`/api/trips/${selectedTrip.id}/download`} aria-label="下载整段旅程"><FileDown size={17} /></a>}</div>
              </div>

              {media.length ? (
                <div className="media-grid" data-testid="media-grid">
                  {media.map((item, index) => (
                    <button className={`media-card media-card-${index % 7 === 0 ? "wide" : "normal"}`} type="button" key={item.id} onClick={() => setLightbox(item)} aria-label={`打开 ${item.originalName}`}>
                      {item.kind === "image" && item.hasThumbnail ? <img src={`/api/media/${item.id}/thumbnail`} alt="" loading="lazy" /> : <div className="video-placeholder">{item.kind === "video" ? <Video size={27} /> : <ImageIcon size={27} />}<span>{item.originalName}</span></div>}
                      <span className="media-overlay">{item.kind === "video" ? <Play size={17} fill="currentColor" /> : <ImageIcon size={16} />}<small>{formatBytes(item.size)}</small></span>
                    </button>
                  ))}
                </div>
              ) : (
                <button className="gallery-empty" type="button" onClick={() => setModal("upload")}><span className="empty-photo-stack"><i /><i /><UploadCloud size={25} /></span><strong>把第一张照片放进来</strong><small>照片与视频会按原文件保存在你的服务器</small></button>
              )}
              {hasMore && <button className="load-more" type="button" disabled={mediaLoading} onClick={() => loadMedia(selectedTrip.id, mediaPage + 1, true)}>{mediaLoading ? <LoaderCircle className="spin" size={17} /> : null}继续展开影像</button>}
            </>
          ) : (
            <div className="no-trip-panel"><span className="empty-compass"><Compass size={36} /></span><span className="eyebrow">从这里出发</span><h2>地球还在等<br />第一个发光的坐标</h2><p>创建一段旅程，再把照片和视频放进属于它的档案里。</p><button className="button button-primary" type="button" onClick={() => setModal("create")}><Plus size={18} />记录第一段旅程</button></div>
          )}
        </aside>
      </main>

      <footer className="footer"><span>迹屿 · 私人旅行档案</span><span>你的数据，留在自己的服务器上</span></footer>

      {modal === "create" && <ModalShell title="点亮一个新坐标" eyebrow="NEW JOURNEY" onClose={() => setModal(null)}><TripForm busy={busy} onSubmit={createTrip} onCancel={() => setModal(null)} /></ModalShell>}
      {modal === "edit" && selectedTrip && <ModalShell title="修改旅行手记" eyebrow="EDIT ARCHIVE" onClose={() => setModal(null)}><TripForm key={selectedTrip.id} initial={selectedTrip} busy={busy} onSubmit={updateTrip} onCancel={() => setModal(null)} /></ModalShell>}
      {modal === "upload" && selectedTrip && (
        <ModalShell title={`把影像放进「${selectedTrip.title}」`} eyebrow="ADD MEMORIES" onClose={() => setModal(null)} size="wide">
          <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFiles(event.dataTransfer.files); }}>
            <input type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime,video/x-matroska" onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
            <span className="upload-icon"><UploadCloud size={27} /></span><strong>拖放照片或视频到这里</strong><span>或点击选择多个文件 · 单文件最大 {config.maxUploadMb} MiB</span><small>文件会逐个上传，适合带宽较小的服务器</small>
          </label>
          {uploadQueue.length > 0 && <div className="upload-list">{uploadQueue.map((item, index) => <div className={`upload-row is-${item.status}`} key={`${item.name}-${index}`}><span className="upload-file-icon">{item.status === "done" ? <Check size={15} /> : item.status === "error" ? <AlertCircle size={15} /> : <ImageIcon size={15} />}</span><div><strong>{item.name}</strong>{item.error && <small>{item.error}</small>}<span className="progress-track"><i style={{ width: `${item.progress}%` }} /></span></div><b>{item.status === "done" ? "完成" : item.status === "error" ? "失败" : `${item.progress}%`}</b></div>)}</div>}
          <div className="modal-actions"><button className="button button-primary" type="button" onClick={() => setModal(null)}>完成</button></div>
        </ModalShell>
      )}
      {modal === "token" && (
        <ModalShell title="输入管理口令" eyebrow="PRIVATE ACCESS" onClose={() => setModal(null)}>
          <form className="token-form" onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("token") || "").trim(); saveAdminToken(value); setModal(null); setToast(value ? "管理操作已解锁" : "已清除管理口令"); }}>
            <span className="token-symbol"><KeyRound size={24} /></span><p>口令只保存在当前浏览器标签页中，用于新增、上传、编辑和删除。</p><label className="field"><span>管理口令</span><input name="token" type="password" autoFocus defaultValue={getAdminToken()} placeholder="输入服务器 ADMIN_TOKEN" /></label><div className="modal-actions"><button className="button button-ghost" type="button" onClick={() => { saveAdminToken(""); setModal(null); setToast("已清除管理口令"); }}>清除</button><button className="button button-primary" type="submit">保存并解锁</button></div>
          </form>
        </ModalShell>
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={lightbox.originalName} onMouseDown={(event) => event.target === event.currentTarget && setLightbox(null)}>
          <button className="lightbox-close" type="button" onClick={() => setLightbox(null)} aria-label="关闭"><X size={22} /></button>
          <div className="lightbox-media">{lightbox.kind === "image" ? <img src={`/api/media/${lightbox.id}/file`} alt={lightbox.originalName} /> : <video src={`/api/media/${lightbox.id}/file`} controls autoPlay preload="metadata" />}</div>
          <div className="lightbox-bar"><div><strong>{lightbox.originalName}</strong><span>{formatBytes(lightbox.size)} · {lightbox.kind === "image" ? "照片" : "视频"}</span></div><div><a className="button button-light" href={`/api/media/${lightbox.id}/download`}><Download size={16} />下载原文件</a><button className="button button-danger" type="button" onClick={() => deleteMedia(lightbox)}><Trash2 size={16} />删除</button></div></div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
