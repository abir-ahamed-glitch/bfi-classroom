import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/admin';

export function useCourseSettings() {
  const [courseSettings, setCourseSettings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/course-settings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCourseSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch course settings', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const getSetting = (courseName, batchNumber, batchId) => {
    if (batchId) {
      const byBatchId = courseSettings.find(s => s.batch_id === Number(batchId));
      if (byBatchId) return byBatchId;
      // When batchId is provided, only fall back to DEFAULT setting for that course,
      // NEVER to another batch's custom setting!
      const defaultSetting = courseSettings.find(s => s.course_name === courseName && s.batch_number === 'DEFAULT');
      return defaultSetting || null;
    }
    let setting = courseSettings.find(s => s.course_name === courseName && s.batch_number === batchNumber && !s.batch_id);
    if (!setting) {
      setting = courseSettings.find(s => s.course_name === courseName && s.batch_number === 'DEFAULT');
    }
    return setting || null;
  };

  return { courseSettings, loading, fetchSettings, getSetting };
}
