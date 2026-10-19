import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

// ============================================================================
// NOTIFICATIONS
// ----------------------------------------------------------------------------
// Two kinds, from two places:
//
// - Review reminders are LOCAL: scheduled on this phone for the next week at
//   the chosen time, each saying how many verses that day holds, and redone
//   whenever the queue changes. No server needed, and they work offline.
// - Social pushes (messages, friend requests, nudges, challenges, answers to
//   requests and quizzes) come from Cloud Functions (functions/src/social.ts)
//   through Expo's push service, to the device tokens saved here under
//   users/{uid}/pushTokens. The functions read users/{uid}/settings/
//   notifications to respect the switches below.
//
// Push needs a real phone and a native build with expo-notifications in it;
// on web and in the simulator this all quietly does nothing.
// ============================================================================

export interface NotificationPrefs {
  messages: boolean;
  circleChat: boolean;
  /** Friend requests, nudges, challenges, quiz results, answers to recording requests. */
  friendActivity: boolean;
  reviewReminder: boolean;
  reminderHour: number;
  reminderMinute: number;
  mutedCircleIds: string[];
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  messages: true,
  circleChat: true,
  friendActivity: true,
  reviewReminder: true,
  reminderHour: 8,
  reminderMinute: 0,
  mutedCircleIds: [],
};

/** One upcoming day for the review reminder. */
export interface ReminderDay {
  date: Date;
  reviews: number;
  learning: number;
}

export type PushTarget =
  | { type: 'dm'; threadId: string; otherUid: string; otherName: string }
  | { type: 'circle'; circleId: string }
  | { type: 'friendRequest' }
  | { type: 'nudge' }
  | { type: 'reviewReminder' };

const PUSH_SUPPORTED = Platform.OS !== 'web';
const ASKED_KEY = 'notifications.askedAt';
const REMINDER_KIND = 'reviewReminder';

// Which chat is on screen right now, so a push for it doesn't also pop a
// banner over the conversation you're already reading. Module-level because
// the handler below is registered once, outside React.
let onScreenChatKey: string | null = null;

if (PUSH_SUPPORTED) {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = (n.request.content.data || {}) as { chatKey?: string };
      const quiet = !!data.chatKey && data.chatKey === onScreenChatKey;
      return {
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: !quiet,
        shouldSetBadge: false,
      };
    },
  });
}

const tokenDocId = (token: string) => token.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);

interface PushDeps {
  user: { uid: string } | null;
  /** 'dm_<threadId>' / 'circle_<circleId>' for the open chat, else null. */
  onScreenChatKey: string | null;
  /** The next week, from the review engine's own projection. */
  reminderDays: ReminderDay[];
  onOpenTarget: (target: PushTarget) => void;
  triggerToast: (msg: string) => void;
}

export function usePushNotifications(deps: PushDeps) {
  const { user } = deps;
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined' | 'unsupported'>(
    PUSH_SUPPORTED ? 'undetermined' : 'unsupported'
  );
  const tokenRef = useRef<string | null>(null);

  onScreenChatKey = deps.onScreenChatKey;

  // ---- prefs + current permission, on sign-in
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid, 'settings', 'notifications'))
      .then((snap) => snap.exists() && setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...(snap.data() as Partial<NotificationPrefs>) }))
      .catch((err) => console.error('Failed to load notification settings:', err));
    if (!PUSH_SUPPORTED) return;
    Notifications.getPermissionsAsync()
      .then((p) => {
        setPermission(p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied');
        // Already allowed (e.g. a reinstall, or a second phone): make sure
        // this device's token is on file without asking again.
        if (p.granted) void registerToken();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const registerToken = async () => {
    if (!PUSH_SUPPORTED || !auth.currentUser || !Device.isDevice) return;
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Messages and reminders',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      tokenRef.current = token;
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'pushTokens', tokenDocId(token)), {
        token,
        platform: Platform.OS,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      // Most often: a build without push credentials yet. Reminders (local)
      // still work, so this isn't worth bothering the user about.
      console.error('Failed to register for push:', err);
    }
  };

  /** Asks the OS once. Returns whether notifications are now allowed. */
  const requestNotificationPermission = async (): Promise<boolean> => {
    if (!PUSH_SUPPORTED) return false;
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()).catch(() => undefined);
    const current = await Notifications.getPermissionsAsync();
    const result = current.granted ? current : await Notifications.requestPermissionsAsync();
    const granted = !!result.granted;
    setPermission(granted ? 'granted' : result.canAskAgain ? 'undetermined' : 'denied');
    if (granted) await registerToken();
    return granted;
  };

  // The soft ask ("Want a heads-up when Sarah replies?") shows at a moment it
  // obviously helps, at most once per install, and only while the OS would
  // still show its own prompt.
  const [notificationAskReason, setNotificationAskReason] = useState<string | null>(null);
  const maybeAskForNotifications = async (reason: string) => {
    if (!PUSH_SUPPORTED || permission !== 'undetermined') return;
    const asked = await AsyncStorage.getItem(ASKED_KEY).catch(() => null);
    if (!asked) setNotificationAskReason(reason);
  };
  const dismissNotificationAsk = () => {
    setNotificationAskReason(null);
    void AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()).catch(() => undefined);
  };

  /** Call before signing out, so this phone stops getting this account's pushes. */
  const unregisterPushToken = async () => {
    const token = tokenRef.current;
    if (!token || !auth.currentUser) return;
    await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'pushTokens', tokenDocId(token))).catch(() => undefined);
    tokenRef.current = null;
  };

  const updateNotificationPrefs = async (patch: Partial<NotificationPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (!auth.currentUser) return;
    await setDoc(doc(db, 'users', auth.currentUser.uid, 'settings', 'notifications'), next, { merge: true }).catch((err) => {
      console.error('Failed to save notification settings:', err);
      deps.triggerToast("Couldn't save that setting.");
    });
  };

  // ---- review reminders: the next 7 days, rescheduled when anything changes
  const reminderKey = deps.reminderDays.map((d) => `${d.date.toDateString()}:${d.reviews}:${d.learning}`).join('|');
  useEffect(() => {
    if (!PUSH_SUPPORTED || !user) return;
    const t = setTimeout(async () => {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(
          scheduled
            .filter((n) => (n.content.data as { kind?: string })?.kind === REMINDER_KIND)
            .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
        );
        if (!prefs.reviewReminder || permission !== 'granted') return;
        const now = Date.now();
        for (const day of deps.reminderDays) {
          const at = new Date(day.date);
          at.setHours(prefs.reminderHour, prefs.reminderMinute, 0, 0);
          if (at.getTime() <= now + 60_000) continue;
          const total = day.reviews + day.learning;
          if (total === 0) continue;
          const parts = [
            day.reviews > 0 ? `${day.reviews} ${day.reviews === 1 ? 'review' : 'reviews'}` : '',
            day.learning > 0 ? `${day.learning} ${day.learning === 1 ? 'verse' : 'verses'} you're learning` : '',
          ].filter(Boolean);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Time for your verses',
              body: `Today: ${parts.join(' and ')}.`,
              data: { kind: REMINDER_KIND, target: { type: 'reviewReminder' } },
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
          });
        }
      } catch (err) {
        console.error('Failed to schedule review reminders:', err);
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, reminderKey, prefs.reviewReminder, prefs.reminderHour, prefs.reminderMinute, permission]);

  // ---- tapping a notification opens what it's about
  const openTargetRef = useRef(deps.onOpenTarget);
  openTargetRef.current = deps.onOpenTarget;
  const handledColdStart = useRef(false);
  useEffect(() => {
    if (!PUSH_SUPPORTED || !user) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const target = (response?.notification.request.content.data as { target?: PushTarget })?.target;
      if (target) openTargetRef.current(target);
    };
    // The tap that launched the app (only once per launch, after sign-in).
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    }
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [user?.uid]);

  return {
    notificationPrefs: prefs,
    notificationPermission: permission,
    updateNotificationPrefs,
    requestNotificationPermission,
    notificationAskReason,
    maybeAskForNotifications,
    dismissNotificationAsk,
    unregisterPushToken,
  };
}
