export interface Draft {
  id: string;
  updatedAt: number;
  data: any;
}

export const getDrafts = (): Draft[] => {
  const draftsStr = localStorage.getItem('techlog_drafts');
  if (!draftsStr) return [];
  try {
    return JSON.parse(draftsStr);
  } catch (e) {
    return [];
  }
};

export const saveDraft = (id: string, data: any) => {
  const drafts = getDrafts();
  const existingIdx = drafts.findIndex(d => d.id === id);
  if (existingIdx >= 0) {
    drafts[existingIdx].data = data;
    drafts[existingIdx].updatedAt = Date.now();
  } else {
    drafts.push({ id, updatedAt: Date.now(), data });
  }
  localStorage.setItem('techlog_drafts', JSON.stringify(drafts));
};

export const deleteDraft = (id: string) => {
  const drafts = getDrafts();
  const filtered = drafts.filter(d => d.id !== id);
  localStorage.setItem('techlog_drafts', JSON.stringify(filtered));
};
