import React, { useState, useMemo } from 'react';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';

export default function ClientPhotos({ selectedClient, clientPhotos = [] }) {
  const [photoLabel, setPhotoLabel] = useState('front');
  const [photoDate, setPhotoDate] = useState(() =>
    new Date().toISOString().split('T')[0]
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [comparePhotos, setComparePhotos] = useState([]);
  const [isPhotoCompareOpen, setIsPhotoCompareOpen] = useState(false);
  const [photoFilter, setPhotoFilter] = useState('all');
  const [zoomedPhoto, setZoomedPhoto] = useState(null);

  const filteredPhotos = useMemo(() => {
    return photoFilter === 'all'
      ? clientPhotos
      : clientPhotos.filter((p) => (p.label || 'other') === photoFilter);
  }, [clientPhotos, photoFilter]);

  const photosByDate = useMemo(() => {
    return filteredPhotos.reduce((acc, photo) => {
      const d = photo.takenAt || 'Unknown';
      if (!acc[d]) acc[d] = [];
      acc[d].push(photo);
      return acc;
    }, {});
  }, [filteredPhotos]);

  const photoDateKeys = Object.keys(photosByDate).sort((a, b) => (a < b ? 1 : -1));

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedClient?.id) return;
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file');
      return;
    }
    setUploadingPhoto(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `client-photos/${selectedClient.id}/${Date.now()}_${photoLabel}_${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, 'clients', selectedClient.id, 'photos'), {
        url,
        storagePath: path,
        label: photoLabel,
        takenAt: photoDate || new Date().toISOString().split('T')[0],
        createdAt: new Date(),
      });
    } catch (err) {
      console.error(err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async (photo) => {
    if (!selectedClient?.id || !photo?.id) return;
    if (!window.confirm('Delete this photo?')) return;
    try {
      if (photo.storagePath) {
        try {
          await deleteObject(ref(storage, photo.storagePath));
        } catch (e) {
          console.warn('Storage delete', e);
        }
      }
      await deleteDoc(doc(db, 'clients', selectedClient.id, 'photos', photo.id));
      setComparePhotos((prev) => prev.filter((p) => p.id !== photo.id));
      if (zoomedPhoto?.id === photo.id) setZoomedPhoto(null);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const toggleComparePhoto = (photo) => {
    setComparePhotos((prev) => {
      if (prev.find((p) => p.id === photo.id)) {
        return prev.filter((p) => p.id !== photo.id);
      }
      if (prev.length >= 2) {
        return [prev[1], photo];
      }
      return [...prev, photo];
    });
  };

  if (!selectedClient) return null;

  return (
    <>
<div className="space-y-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-300">
                        Progress photos ({filteredPhotos.length}
                        {photoFilter !== 'all' ? ` · ${photoFilter}` : ''})
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Tap a photo to zoom. Use + to select two, then Compare.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Date</label>
                        <input
                          type="date"
                          value={photoDate}
                          onChange={(e) => setPhotoDate(e.target.value)}
                          className="block mt-0.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Angle</label>
                        <select
                          value={photoLabel}
                          onChange={(e) => setPhotoLabel(e.target.value)}
                          className="block mt-0.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                        >
                          <option value="front">Front</option>
                          <option value="side">Side</option>
                          <option value="back">Back</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <label className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white cursor-pointer">
                        {uploadingPhoto ? 'Uploading…' : '+ Upload'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingPhoto}
                          onChange={handlePhotoUpload}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={comparePhotos.length !== 2}
                        onClick={() => setIsPhotoCompareOpen(true)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white disabled:opacity-40"
                      >
                        Compare ({comparePhotos.length}/2)
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'front', label: 'Front' },
                      { id: 'side', label: 'Side' },
                      { id: 'back', label: 'Back' },
                      { id: 'other', label: 'Other' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setPhotoFilter(f.id)}
                        className={`px-3 py-1 text-[11px] font-bold rounded-lg border ${photoFilter === f.id
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {photoDateKeys.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-sm text-slate-400">
                      No photos{photoFilter !== 'all' ? ` for “${photoFilter}”` : ' yet'}.
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {photoDateKeys.map((dateKey) => (
                        <div key={dateKey}>
                          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                            {dateKey}
                            <span className="text-slate-600 font-medium normal-case ml-2">
                              ({photosByDate[dateKey].length})
                            </span>
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                            {photosByDate[dateKey].map((photo) => {
                              const selected = comparePhotos.some((p) => p.id === photo.id);
                              return (
                                <div
                                  key={photo.id}
                                  className={`relative rounded-xl border overflow-hidden bg-slate-900 ${selected
                                    ? 'border-blue-500 ring-1 ring-blue-500/50'
                                    : 'border-slate-800'
                                    }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setZoomedPhoto(photo)}
                                    className="block w-full aspect-square bg-slate-950"
                                    title="Zoom"
                                  >
                                    <img
                                      src={photo.url}
                                      alt={photo.label}
                                      className="w-full h-full object-cover"
                                    />
                                  </button>
                                  <div className="absolute top-1 left-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleComparePhoto(photo);
                                      }}
                                      className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${selected
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-black/60 text-white hover:bg-black/80'
                                        }`}
                                    >
                                      {selected ? '✓' : '+'}
                                    </button>
                                  </div>
                                  <div className="absolute top-1 right-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeletePhoto(photo);
                                      }}
                                      className="px-1.5 py-0.5 text-[9px] rounded bg-black/60 text-white hover:bg-red-600/90"
                                    >
                                      🗑
                                    </button>
                                  </div>
                                  <div className="px-1.5 py-1 text-[10px] font-bold text-slate-300 uppercase truncate bg-slate-900/90">
                                    {photo.label}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {zoomedPhoto && (
                    <div
                      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
                      onClick={() => setZoomedPhoto(null)}
                    >
                      <div
                        className="relative max-w-3xl w-full"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-sm font-bold text-white">
                            <span className="uppercase text-slate-400 mr-2">{zoomedPhoto.label}</span>
                            {zoomedPhoto.takenAt}
                          </div>
                          <button
                            type="button"
                            onClick={() => setZoomedPhoto(null)}
                            className="text-slate-300 hover:text-white text-2xl leading-none"
                          >
                            ×
                          </button>
                        </div>
                        <img
                          src={zoomedPhoto.url}
                          alt={zoomedPhoto.label}
                          className="w-full max-h-[80vh] object-contain rounded-xl bg-black"
                        />
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => toggleComparePhoto(zoomedPhoto)}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white"
                          >
                            {comparePhotos.some((p) => p.id === zoomedPhoto.id)
                              ? 'Selected for compare'
                              : 'Add to compare'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setZoomedPhoto(null)}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {isPhotoCompareOpen && comparePhotos.length === 2 && (
                    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl p-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <h3 className="text-sm font-bold text-white">Compare photos</h3>
                          <button
                            type="button"
                            onClick={() => setIsPhotoCompareOpen(false)}
                            className="text-slate-400 hover:text-white text-xl"
                          >
                            ×
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {comparePhotos.map((photo) => (
                            <div key={photo.id} className="space-y-2">
                              <div className="text-xs text-slate-400 font-bold uppercase">
                                {photo.label} · {photo.takenAt}
                              </div>
                              <img
                                src={photo.url}
                                alt={photo.label}
                                className="w-full rounded-xl object-contain max-h-[70vh] bg-black"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
      </div>

    </>
  );
}