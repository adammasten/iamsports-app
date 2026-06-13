import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/supabase';
import { clipMatchesGroup } from '@/lib/core/clip-filtering';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const SERVER_URL = 'https://web-production-1bf7f.up.railway.app';
const ACTIVE_JOB_KEY = 'iamsports.active_export_job';
const ACTIVE_JOB_TTL_MS = 2 * 60 * 60 * 1000;

// Tier 1 export resume: persist the in-flight jobId so backgrounding the app
// (or unmounting the export screen) doesn't lose it. On mount or foreground,
// we read this back and either resume polling or pick up a finished job.
async function clearActiveJob() {
  try { await AsyncStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
}

async function saveActiveJob(jobId: string) {
  try {
    await AsyncStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, startedAt: Date.now() }));
  } catch {}
}

// Derive the bare storage object key from a finished-job URL. videos.url stores
// the object key (path within the private 'Videos' bucket), NOT a full URL —
// see app/game.tsx. Railway writes exports to the exports/ subfolder, so the key
// is e.g. "exports/<file>.mp4". Strips everything up to and including "/Videos/"
// plus any query string (signed-URL token). Falls back to the query-stripped
// input if no bucket marker is present.
function deriveStoragePath(url: string): string {
  const marker = '/Videos/';
  const idx = url.indexOf(marker);
  const afterBucket = idx >= 0 ? url.slice(idx + marker.length) : url;
  return afterBucket.split('?')[0];
}

async function readActiveJob(): Promise<{ jobId: string; startedAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.jobId || typeof parsed.startedAt !== 'number') return null;
    if (Date.now() - parsed.startedAt > ACTIVE_JOB_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function ExportScreen() {
  const [games, setGames] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [tagGroups, setTagGroups] = useState<string[][]>([]);
  const [currentGroup, setCurrentGroup] = useState<string[]>([]);
  const [clips, setClips] = useState<any[]>([]);
  const [excludedClips, setExcludedClips] = useState<string[]>([]);
  const [step, setStep] = useState<'games' | 'tags' | 'review'>('games');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  // Tier 1: when resuming a persisted job we skip the clip-selector view and
  // show only the progress card.
  const [resuming, setResuming] = useState(false);

  // Polling refs — mountedRef gates setState calls after unmount, intervalRef
  // lets the cleanup effect clear the active poll if the user navigates away
  // mid-export. The server keeps processing regardless; we just stop listening.
  const mountedRef = useRef(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards the foreground AppState handler from racing with an active export.
  const exportingRef = useRef(false);
  useEffect(() => { exportingRef.current = exporting; }, [exporting]);

  useEffect(() => {
    fetchGames();
    fetchTags();
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  async function saveExportToLibrary(videoUrl: string) {
    setExportStatus('Saving to camera roll...');
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      const localPath = FileSystem.documentDirectory + 'highlight.mp4';
      await FileSystem.downloadAsync(videoUrl, localPath);
      await MediaLibrary.saveToLibraryAsync(localPath);
      Alert.alert('Saved! 🎉', 'Your highlight reel has been saved to your camera roll!');
    } else {
      Alert.alert('Export Ready! 🎉', 'Video exported successfully!');
    }
  }

  // After a render finishes, persist the export as a highlight_reels row so it
  // becomes a findable reel. Best-effort: never throws, never blocks the
  // camera-roll save or success UI. team_id is null for now (reels are
  // creator-owned; team association is derived later from source clips).
  async function saveReelRecord(videoUrl: string, includedClipObjects: any[]) {
    try {
      if (includedClipObjects.length === 0) return;

      // created_by_user_id is REQUIRED — the RLS creator branch depends on it.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('[reel] No session user — skipping highlight_reels insert');
        return;
      }

      const gameTitles = [...new Set(includedClipObjects.map(c => c.gameTitle).filter(Boolean))];
      const reelName = gameTitles.length > 0
        ? `${gameTitles.join(' · ')} Highlights`
        : `Highlights · ${new Date().toLocaleDateString()}`;
      const durationSeconds = includedClipObjects.reduce(
        (sum, c) => sum + Math.max(0, (c.end_time ?? 0) - (c.start_time ?? 0)),
        0,
      );

      const { error } = await supabase.from('highlight_reels').insert({
        created_by_user_id: user.id,
        team_id: null,
        name: reelName,
        storage_path: deriveStoragePath(videoUrl),
        source_clip_ids: includedClipObjects.map(c => c.id),
        duration_seconds: durationSeconds,
        overlay_mode: 'clean',
        status: 'ready',
      });
      if (error) console.warn('[reel] highlight_reels insert failed:', error.message);
    } catch (e: any) {
      console.warn('[reel] highlight_reels insert threw:', e?.message || e);
    }
  }

  // Tier 1 resume: on mount and on foreground, check AsyncStorage for an
  // in-flight job and either pick up its result or resume polling.
  async function checkForActiveExport() {
    if (exportingRef.current) return;
    const active = await readActiveJob();
    if (!active) return;

    let job: any;
    try {
      const response = await fetch(`${SERVER_URL}/job/${active.jobId}`);
      if (response.status === 404) {
        await clearActiveJob();
        return;
      }
      job = await response.json();
    } catch {
      // Network unreachable — leave the stored job alone; retry next foreground.
      return;
    }

    if (!mountedRef.current) return;
    setResuming(true);
    setExporting(true);
    setStep('review');
    setExportProgress(job.progress || 0);
    setExportStatus(job.label || `Processing... ${job.progress || 0}%`);

    const finishResume = () => {
      if (!mountedRef.current) return;
      setExporting(false);
      setResuming(false);
      setExportProgress(0);
      setExportStatus('');
      setStep('games');
    };

    if (job.status === 'done') {
      await clearActiveJob();
      try { await saveExportToLibrary(job.url); }
      catch (e: any) { Alert.alert('Save error', e?.message || 'Failed to save to camera roll'); }
      finishResume();
      return;
    }
    if (job.status === 'failed') {
      await clearActiveJob();
      Alert.alert('Export failed', job.error || 'Unknown error');
      finishResume();
      return;
    }

    // Still processing — resume polling. pollJob clears AsyncStorage on done/failed.
    try {
      const url = await pollJob(active.jobId);
      if (!mountedRef.current) return;
      await saveExportToLibrary(url);
    } catch (e: any) {
      Alert.alert('Export error', e?.message || 'Polling failed');
    } finally {
      finishResume();
    }
  }

  useEffect(() => {
    checkForActiveExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkForActiveExport();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchGames() {
    const { data } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    setGames(data || []);
  }

  async function fetchTags() {
    const { data } = await supabase.from('tags').select('*').order('category', { ascending: true });
    setTags(data || []);
  }

  // Special-category tags ('★ Highlight', 'POE') are surfaced only via the
  // dedicated HIGHLIGHTS / EMPHASIS buttons below. Derived from `tags` on
  // every render — cheap O(n) and avoids a separate state. Undefined until
  // the fetch completes; button onPress no-ops in that window.
  const highlightTagId = tags.find(t => t.category === 'special' && t.name === '★ Highlight')?.id;
  const poeTagId = tags.find(t => t.category === 'special' && t.name === 'POE')?.id;

  function toggleGame(id: string) {
    setSelectedGames(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]);
  }

  function toggleTagInGroup(id: string) {
    setCurrentGroup(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  function addGroup() {
    if (currentGroup.length === 0) { Alert.alert('Select at least one tag first'); return; }
    setTagGroups(prev => [...prev, currentGroup]);
    setCurrentGroup([]);
  }

  function removeGroup(index: number) {
    setTagGroups(prev => prev.filter((_, i) => i !== index));
  }

  function getTagName(id: string) {
    return tags.find(t => t.id === id)?.name || id;
  }

  function toggleExclude(id: string) {
    setExcludedClips(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  }

  async function loadClips() {
    const allGroups = currentGroup.length > 0 ? [...tagGroups, currentGroup] : tagGroups;
    if (selectedGames.length === 0) { Alert.alert('Select at least one game'); return; }
    if (allGroups.length === 0) { Alert.alert('Add at least one tag group'); return; }
    setLoading(true);

    const { data: videos } = await supabase
      .from('videos')
      .select('id, url, label, game_id')
      .in('game_id', selectedGames);
    const videoMap: Record<string, any> = {};
    (videos || []).forEach((v: any) => { videoMap[v.id] = v; });
    const videoIds = Object.keys(videoMap);

    if (videoIds.length === 0) {
      Alert.alert('No videos found for selected games');
      setLoading(false);
      return;
    }

    const { data: clipData } = await supabase
      .from('clips')
      .select('*')
      .in('video_id', videoIds);

    const clipsWithTags = await Promise.all((clipData || []).map(async (clip: any) => {
      const { data: tagData } = await supabase
        .from('clip_tags')
        .select('tag_id, bundle_number')
        .eq('clip_id', clip.id);

      // Organize tags by bundle
      const clipLevelTagIds: string[] = [];
      const bundleMap: Record<number, string[]> = {};
      (tagData || []).forEach((t: any) => {
        const bn = t.bundle_number ?? 0;
        if (bn === 0) {
          clipLevelTagIds.push(t.tag_id);
        } else {
          if (!bundleMap[bn]) bundleMap[bn] = [];
          bundleMap[bn].push(t.tag_id);
        }
      });
      const bundles = Object.values(bundleMap);
      const tagIds = (tagData || []).map((t: any) => t.tag_id);

      const video = videoMap[clip.video_id];
      const game = games.find(g => g.id === video?.game_id);
      return {
        ...clip,
        tagIds,
        clipLevelTagIds,
        bundles,
        videoUrl: video?.url,
        videoLabel: video?.label,
        gameTitle: game?.title,
      };
    }));

    // Match clips to groups using bundle-aware AND logic
    const matchedClips: any[] = [];
    allGroups.forEach((group, groupIndex) => {
      const groupClips = clipsWithTags.filter(clip => clipMatchesGroup(clip, group));
      groupClips.forEach(clip => {
        matchedClips.push({ ...clip, groupIndex, groupTags: group });
      });
    });

    setClips(matchedClips);
    setExcludedClips([]);
    if (currentGroup.length > 0) setTagGroups(allGroups);
    setCurrentGroup([]);
    setStep('review');
    setLoading(false);
  }

  async function pollJob(jobId: string) {
    return new Promise<string>((resolve, reject) => {
      const stopPolling = () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
      pollIntervalRef.current = setInterval(async () => {
        if (!mountedRef.current) { stopPolling(); return; }
        try {
          const response = await fetch(`${SERVER_URL}/job/${jobId}`);
          const job = await response.json();
          if (!mountedRef.current) { stopPolling(); return; }
          setExportProgress(job.progress || 0);
          setExportStatus(job.label || `Processing... ${job.progress || 0}%`);
          if (job.status === 'done') {
            stopPolling();
            clearActiveJob().catch(() => {});
            resolve(job.url);
          } else if (job.status === 'failed') {
            stopPolling();
            clearActiveJob().catch(() => {});
            reject(new Error(job.error || 'Export failed'));
          }
        } catch (e) {
          // Transient fetch error — stop the interval but keep the stored job so
          // a future mount/foreground can resume polling.
          stopPolling();
          reject(e);
        }
      }, 3000);
    });
  }

  async function handleExport() {
    console.log('[export] handleExport called');
    setExporting(true);
    setExportStatus('Starting export...');
    setExportProgress(0);

    const includedClipObjects = clips
      .filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`));
    const includedClips = includedClipObjects
      .map(c => ({ url: c.videoUrl, start_time: c.start_time, end_time: c.end_time }));
    console.log('[export] includedClips count:', includedClips.length, 'first clip:', includedClips[0]);

    try {
      console.log('[export] POSTing to Railway', `${SERVER_URL}/export`, 'clips:', includedClips.length);
      const response = await fetch(`${SERVER_URL}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: includedClips, outputFileName: 'iamsports-highlight.mp4' }),
      });

      const data = await response.json();
      if (!response.ok) { console.log('[export] server rejected:', response.status, data); Alert.alert('Export failed', data.error || 'Something went wrong'); setExporting(false); return; }

      // Persist before polling so a backgrounded app can resume this job.
      await saveActiveJob(data.jobId);

      setExportStatus('Processing clips...');
      const videoUrl = await pollJob(data.jobId);

      // Persist the export as a reel (best-effort — must not block the save).
      await saveReelRecord(videoUrl, includedClipObjects);

      await saveExportToLibrary(videoUrl);
    } catch (e: any) {
      console.log('[export] FAILED:', e);
      Alert.alert('Export error', e.message);
    }
    setExporting(false);
    setExportStatus('');
    setExportProgress(0);
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getDuration(start: number, end: number) {
    return `${Math.round(end - start)}s`;
  }

  // Tier 1 resume mode: skip the wizard, show only progress until the
  // restored job finishes (success or failure clears resuming back to false).
  if (resuming) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Resuming previous export...</Text>
        {exporting && (
          <View style={styles.exportingContainer}>
            <Text style={styles.exportingText}>{exportStatus}</Text>
            <View style={styles.progressOuter}>
              <View style={[styles.progressInner, { width: `${exportProgress}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>{exportProgress}%</Text>
          </View>
        )}
      </View>
    );
  }

  if (step === 'games') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 1 of 3 — Pick games to include</Text>
        <FlatList
          data={games}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.selectCard, selectedGames.includes(item.id) && styles.selectedCard]}
              onPress={() => toggleGame(item.id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, selectedGames.includes(item.id) && styles.selectedText]}>{item.title}</Text>
                <Text style={[styles.cardSub, selectedGames.includes(item.id) && { color: '#ddd' }]}>{item.game_date}</Text>
              </View>
              {selectedGames.includes(item.id) && <Text style={styles.check}>✓</Text>}
            </TouchableOpacity>
          )}
        />
        <TouchableOpacity
          style={[styles.nextBtn, selectedGames.length === 0 && styles.disabledBtn]}
          onPress={() => selectedGames.length > 0 && setStep('tags')}
        >
          <Text style={styles.nextBtnText}>Next: Build Tag Groups →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'tags') {
    const categories = ['offense', 'defense', 'plays', 'players'];
    const highlightSelected = !!highlightTagId && currentGroup.includes(highlightTagId);
    const poeSelected = !!poeTagId && currentGroup.includes(poeTagId);
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => setStep('games')} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 2 of 3 — Build tag groups</Text>
        <Text style={styles.hint}>Tap tags to build a group. Tap "Add Group" to save it and start another.</Text>

        {tagGroups.length > 0 && (
          <View style={styles.groupsContainer}>
            <Text style={styles.groupsLabel}>Your groups:</Text>
            {tagGroups.map((group, index) => (
              <View key={index} style={styles.groupPill}>
                <Text style={styles.groupPillText}>
                  {group.map(id => getTagName(id)).join(' + ')}
                </Text>
                <TouchableOpacity onPress={() => removeGroup(index)}>
                  <Text style={styles.groupPillRemove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {currentGroup.length > 0 && (
          <View style={styles.currentGroup}>
            <Text style={styles.currentGroupLabel}>Current group:</Text>
            <Text style={styles.currentGroupTags}>
              {currentGroup.map(id => getTagName(id)).join(' + ')}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HIGHLIGHTS</Text>
          <View style={styles.tagGrid}>
            <TouchableOpacity
              style={[styles.tagBtnHighlight, highlightSelected && styles.tagBtnHighlightSelected]}
              onPress={() => highlightTagId && toggleTagInGroup(highlightTagId)}
            >
              <Text style={[styles.tagBtnHighlightText, highlightSelected && styles.tagBtnHighlightTextSelected]}>
                ★ Highlight
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>EMPHASIS</Text>
          <View style={styles.tagGrid}>
            <TouchableOpacity
              style={[styles.tagBtnPOE, poeSelected && styles.tagBtnPOESelected]}
              onPress={() => poeTagId && toggleTagInGroup(poeTagId)}
            >
              <Text style={[styles.tagBtnPOEText, poeSelected && styles.tagBtnPOETextSelected]}>
                ! POE
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {categories.map(cat => {
          const catTags = tags.filter(t => t.category === cat);
          if (catTags.length === 0) return null;
          return (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionTitle}>{cat.toUpperCase()}</Text>
              <View style={styles.tagGrid}>
                {catTags.map(tag => (
                  <TouchableOpacity
                    key={tag.id}
                    style={[styles.tagBtn, currentGroup.includes(tag.id) && styles.tagBtnSelected]}
                    onPress={() => toggleTagInGroup(tag.id)}
                  >
                    <Text style={[styles.tagBtnText, currentGroup.includes(tag.id) && styles.tagBtnTextSelected]}>
                      {tag.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}

        <View style={styles.groupActions}>
          <TouchableOpacity
            style={[styles.addGroupBtn, currentGroup.length === 0 && styles.disabledBtn]}
            onPress={addGroup}
          >
            <Text style={styles.addGroupBtnText}>+ Add Group</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.nextBtn, (tagGroups.length === 0 && currentGroup.length === 0) && styles.disabledBtn]}
          onPress={loadClips}
        >
          <Text style={styles.nextBtnText}>{loading ? 'Loading...' : 'Next: Review Clips →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const groupedClips: Record<number, any[]> = {};
  clips.forEach(clip => {
    if (!groupedClips[clip.groupIndex]) groupedClips[clip.groupIndex] = [];
    groupedClips[clip.groupIndex].push(clip);
  });
  const totalIncluded = clips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`)).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity onPress={() => setStep('tags')} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Export Highlights</Text>
      <Text style={styles.subtitle}>Step 3 of 3 — Review ({totalIncluded} clips selected)</Text>
      <Text style={styles.hint}>✕ to exclude • ▶ to preview</Text>

      {exporting && (
        <View style={styles.exportingContainer}>
          <Text style={styles.exportingText}>{exportStatus}</Text>
          <View style={styles.progressOuter}>
            <View style={[styles.progressInner, { width: `${exportProgress}%` as any }]} />
          </View>
          <Text style={styles.progressLabel}>{exportProgress}%</Text>
        </View>
      )}

      {Object.keys(groupedClips).map(groupIndexStr => {
        const groupIndex = parseInt(groupIndexStr);
        const groupClips = groupedClips[groupIndex];
        const groupTags = tagGroups[groupIndex] || [];
        const groupLabel = groupTags.map(id => getTagName(id)).join(' + ');

        return (
          <View key={groupIndex} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{groupLabel}</Text>
              <Text style={styles.groupCount}>
                {groupClips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`)).length}/{groupClips.length}
              </Text>
            </View>
            {groupClips.map((clip: any) => {
              const clipKey = `${clip.id}-${clip.groupIndex}`;
              const excluded = excludedClips.includes(clipKey);
              return (
                <View key={clipKey} style={[styles.clipCard, excluded && styles.excludedCard]}>
                  <TouchableOpacity
                    style={[styles.checkBtn, excluded && styles.checkBtnExcluded]}
                    onPress={() => toggleExclude(clipKey)}
                  >
                    <Text style={styles.checkBtnText}>{excluded ? '✕' : '✓'}</Text>
                  </TouchableOpacity>
                  <View style={styles.clipInfo}>
                    <View style={styles.clipTop}>
                      <Text style={[styles.clipTime, excluded && styles.excludedText]}>
                        {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                      </Text>
                      <Text style={styles.clipDuration}>{getDuration(clip.start_time, clip.end_time)}</Text>
                      {!!highlightTagId && clip.tagIds?.includes(highlightTagId) && <Text style={styles.star}>★</Text>}
                    </View>
                    <Text style={[styles.clipMeta, excluded && styles.excludedText]}>
                      {clip.gameTitle} • {clip.videoLabel}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.previewBtn}
                    onPress={() => router.push({
                      pathname: '/tagging-overlay',
                      params: { videoId: clip.video_id, url: clip.videoUrl, label: clip.videoLabel, startAt: clip.start_time }
                    })}
                  >
                    <Text style={styles.previewBtnText}>▶</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        );
      })}

      {totalIncluded > 0 && !exporting && (
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>🎬 Export {totalIncluded} Clips</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  back: { marginBottom: 16 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 8 },
  hint: { fontSize: 12, color: '#aaa', marginBottom: 16 },
  exportingContainer: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 20 },
  exportingText: { fontSize: 14, fontWeight: '600', color: '#534AB7', marginBottom: 10, textAlign: 'center' },
  progressOuter: { backgroundColor: '#ddd', borderRadius: 8, height: 12, overflow: 'hidden', marginBottom: 6 },
  progressInner: { backgroundColor: '#534AB7', height: 12, borderRadius: 8 },
  progressLabel: { textAlign: 'center', fontSize: 12, color: '#888' },
  selectCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedCard: { backgroundColor: '#534AB7' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 12, color: '#888', marginTop: 2 },
  selectedText: { color: '#fff' },
  check: { color: '#fff', fontSize: 18, fontWeight: '700' },
  nextBtn: { backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  disabledBtn: { backgroundColor: '#ccc' },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  groupsContainer: { backgroundColor: '#f0eeff', borderRadius: 12, padding: 12, marginBottom: 16 },
  groupsLabel: { fontSize: 12, fontWeight: '700', color: '#534AB7', marginBottom: 8 },
  groupPill: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#534AB7', borderRadius: 8, padding: 8, marginBottom: 6 },
  groupPillText: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },
  groupPillRemove: { color: '#fff', fontSize: 16, marginLeft: 8 },
  currentGroup: { backgroundColor: '#fff3cd', borderRadius: 12, padding: 12, marginBottom: 16 },
  currentGroupLabel: { fontSize: 12, fontWeight: '700', color: '#856404', marginBottom: 4 },
  currentGroupTags: { fontSize: 14, color: '#856404', fontWeight: '600' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#888', marginBottom: 8, letterSpacing: 0.5 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagBtn: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  tagBtnSelected: { backgroundColor: '#534AB7' },
  tagBtnText: { fontSize: 13, color: '#333', fontWeight: '500' },
  tagBtnTextSelected: { color: '#fff' },
  tagBtnHighlight: {
    backgroundColor: '#fff8e1',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: '#EF9F27',
  },
  tagBtnHighlightSelected: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  tagBtnHighlightText: { fontSize: 13, color: '#EF9F27', fontWeight: '700' },
  tagBtnHighlightTextSelected: { color: '#fff' },
  tagBtnPOE: {
    backgroundColor: '#fff5f5',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: '#DC3545',
  },
  tagBtnPOESelected: { backgroundColor: '#DC3545', borderColor: '#DC3545' },
  tagBtnPOEText: { fontSize: 13, color: '#DC3545', fontWeight: '700' },
  tagBtnPOETextSelected: { color: '#fff' },
  groupActions: { marginBottom: 8 },
  addGroupBtn: { backgroundColor: '#1D9E75', borderRadius: 12, padding: 14, alignItems: 'center' },
  addGroupBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  group: { marginBottom: 20 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  groupTitle: { fontSize: 14, fontWeight: '700', color: '#534AB7', flex: 1 },
  groupCount: { fontSize: 12, color: '#888' },
  clipCard: { backgroundColor: '#f5f5f5', borderRadius: 8, padding: 8, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  excludedCard: { backgroundColor: '#f9f9f9', opacity: 0.5 },
  checkBtn: { backgroundColor: '#1D9E75', borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  checkBtnExcluded: { backgroundColor: '#e74c3c' },
  checkBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  clipInfo: { flex: 1 },
  clipTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  clipTime: { fontSize: 12, fontWeight: '600' },
  clipDuration: { fontSize: 10, color: '#888', backgroundColor: '#e0e0e0', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  star: { fontSize: 12, color: '#EF9F27' },
  excludedText: { color: '#bbb' },
  clipMeta: { fontSize: 11, color: '#888' },
  previewBtn: { backgroundColor: '#534AB7', borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  previewBtnText: { color: '#fff', fontSize: 12 },
  exportBtn: { backgroundColor: '#1D9E75', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 8 },
  exportBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, fontSize: 16 },
});
