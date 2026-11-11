import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { register } from '../services/auth';
import { useAuth } from '../services/AuthContext';
import { fieldErrors, registerSchema } from '../lib/validation';
import { Button, Field, FormError, Muted, Screen, Title } from '../ui/components';
import { errorMessage } from '../ui/dialogs';
import { colors, space } from '../ui/theme';

/** Простая оценка надёжности пароля — подсказка пользователю. */
function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-zа-яё]/.test(pw) && /[A-ZА-ЯЁ]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-zА-Яа-яЁё0-9]/.test(pw)) s++;
  if (s <= 2) return { score: s, label: 'слабый', color: colors.danger };
  if (s <= 3) return { score: s, label: 'средний', color: colors.gold };
  return { score: s, label: 'надёжный', color: colors.success };
}

export default function RegisterScreen() {
  const db = useSQLiteContext();
  const { signIn } = useAuth();
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const st = strength(form.password);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setFormError(null);
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      signIn(await register(db, parsed.data.username, parsed.data.password));
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Создать аккаунт</Title>
      <Muted style={{ marginBottom: space.lg }}>
        Каждый игрок на устройстве может иметь свой аккаунт — герои и приключения видны только владельцу.
      </Muted>
      <FormError message={formError} />
      <Field
        label="Логин"
        value={form.username}
        onChangeText={set('username')}
        autoCapitalize="none"
        maxLength={24}
        error={errors.username}
        hint="3–24 символа: латиница, цифры, _ . -"
      />
      <Field
        label="Пароль"
        value={form.password}
        onChangeText={set('password')}
        secureTextEntry
        maxLength={64}
        error={errors.password}
        hint="Минимум 8 символов, буква и цифра"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {form.password.length > 0 && (
        <View style={styles.meter}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.seg, { backgroundColor: i < st.score ? st.color : colors.surfaceAlt }]} />
          ))}
          <Text style={[styles.meterText, { color: st.color }]}>{st.label}</Text>
        </View>
      )}
      <Field
        label="Повторите пароль"
        value={form.confirm}
        onChangeText={set('confirm')}
        secureTextEntry
        maxLength={64}
        error={errors.confirm}
        onSubmitEditing={submit}
      />
      <Button title="Зарегистрироваться" icon="📜" onPress={submit} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -6, marginBottom: space.md },
  seg: { flex: 1, height: 5, borderRadius: 3 },
  meterText: { marginLeft: space.sm, fontSize: 12, fontWeight: '700', width: 70 },
});
