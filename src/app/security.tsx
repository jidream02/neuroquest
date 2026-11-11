import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { listAudit, type AuditEvent } from '../db/repo';
import { changePasswordSchema, fieldErrors } from '../lib/validation';
import { changePassword, deleteAccount, SESSION_TTL_MS } from '../services/auth';
import { AUTO_LOCK_MS, useAuth, useSession } from '../services/AuthContext';
import { Button, Card, Field, FormError, Muted, Screen, SectionTitle, Spacer } from '../ui/components';
import { confirmAsync, errorMessage, notify } from '../ui/dialogs';
import { colors, space } from '../ui/theme';
import { useLoad } from '../ui/useLoad';

const EVENTS: Record<AuditEvent, string> = {
  register: '🆕 Регистрация',
  login_ok: '✅ Успешный вход',
  login_fail: '❌ Неверный пароль',
  login_locked: '⛔ Попытка входа при блокировке',
  logout: '🚪 Выход',
  auto_lock: '🔒 Автоблокировка',
  password_changed: '🔑 Пароль изменён',
  backup_created: '💾 Создан бэкап',
  backup_restored: '♻️ Восстановлено из бэкапа',
  restore_failed: '⚠️ Ошибка восстановления',
};

export default function SecurityScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const { signOut } = useAuth();
  const { data: log, reload } = useLoad(useCallback(() => listAudit(db, userId, 30), [db, userId]));

  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setFormError(null);
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setBusy(true);
    try {
      await changePassword(db, userId, parsed.data.current, parsed.data.next);
      setForm({ current: '', next: '', confirm: '' });
      notify('Готово', 'Пароль изменён.');
      await reload();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    setDelErr(null);
    if (!delPw) return setDelErr('Введите пароль для подтверждения');
    if (!(await confirmAsync('Удалить аккаунт?', 'Все герои, приключения и история будут удалены навсегда.', 'Удалить', true))) return;
    try {
      await deleteAccount(db, userId, delPw);
      await signOut('logout');
    } catch (e) {
      setDelErr(errorMessage(e));
    }
  };

  return (
    <Screen>
      <SectionTitle>Как защищены данные</SectionTitle>
      <Card>
        {[
          '🔑 Пароль хранится только как хэш PBKDF2-SHA256 с уникальной солью',
          '⛔ После 5 неверных попыток вход блокируется (от 30 с до 15 мин)',
          `🔒 Автоблокировка через ${AUTO_LOCK_MS / 60000} мин в фоне, сессия — ${SESSION_TTL_MS / 60000} мин`,
          '🗝️ Сессия хранится в защищённом хранилище ОС (Keychain / Keystore)',
          '👥 Каждый пользователь видит только свои данные',
          '🧹 Весь ввод проверяется и очищается перед сохранением',
          '🛰️ Ключ ИИ хранится на сервере, а не в приложении',
          '💾 Бэкапы зашифрованы AES-256-GCM',
        ].map((t) => (
          <Text key={t} style={styles.point}>
            {t}
          </Text>
        ))}
      </Card>

      <SectionTitle>Сменить пароль</SectionTitle>
      <FormError message={formError} />
      <Field label="Текущий пароль" value={form.current} onChangeText={set('current')} secureTextEntry maxLength={64} error={errors.current} />
      <Field label="Новый пароль" value={form.next} onChangeText={set('next')} secureTextEntry maxLength={64} error={errors.next} hint="Минимум 8 символов, буква и цифра" />
      <Field label="Повторите новый пароль" value={form.confirm} onChangeText={set('confirm')} secureTextEntry maxLength={64} error={errors.confirm} />
      <Button title="Сменить пароль" icon="🔑" onPress={submit} loading={busy} />

      <SectionTitle>Журнал безопасности</SectionTitle>
      <Card>
        {log?.length === 0 ? <Muted>Событий нет.</Muted> : null}
        {log?.map((e) => (
          <View key={e.id} style={styles.logRow}>
            <Text style={styles.logEvent}>
              {EVENTS[e.event] ?? e.event}
              {e.details ? <Text style={styles.logDetails}> · {e.details}</Text> : null}
            </Text>
            <Muted style={styles.logDate}>{new Date(e.created_at).toLocaleString()}</Muted>
          </View>
        ))}
      </Card>

      <SectionTitle>Опасная зона</SectionTitle>
      <FormError message={delErr} />
      <Field label="Пароль для подтверждения" value={delPw} onChangeText={setDelPw} secureTextEntry maxLength={64} />
      <Button variant="danger" title="Удалить аккаунт и все данные" icon="⚠️" onPress={removeAccount} />
      <Spacer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  point: { color: colors.text, fontSize: 14, lineHeight: 22, marginBottom: 4 },
  logRow: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  logEvent: { color: colors.text, fontSize: 14 },
  logDetails: { color: colors.textMuted },
  logDate: { fontSize: 12, marginTop: space.xs / 2 },
});
