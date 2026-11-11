import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AuthError, login } from '../services/auth';
import { useAuth } from '../services/AuthContext';
import { loginSchema, fieldErrors } from '../lib/validation';
import { Button, Field, FormError, Muted, Screen } from '../ui/components';
import { errorMessage } from '../ui/dialogs';
import { colors, fonts, space } from '../ui/theme';

export default function LoginScreen() {
  const db = useSQLiteContext();
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(0); // текущее время обновляется таймером только во время блокировки
  const [busy, setBusy] = useState(false);

  // Таймер обратного отсчёта, пока аккаунт заблокирован.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const lockLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  const submit = async () => {
    setFormError(null);
    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const session = await login(db, parsed.data.username, parsed.data.password);
      setPassword('');
      signIn(session);
    } catch (e) {
      setFormError(errorMessage(e));
      if (e instanceof AuthError && e.lockedUntil) {
        setLockedUntil(e.lockedUntil);
        setNow(Date.now());
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <Image source={require('../../assets/images/logo.png')} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text style={styles.brand}>NeuroQuest</Text>
          <Muted style={styles.tagline}>Настольная ролевая игра, где мастер — искусственный интеллект</Muted>
        </View>

        <FormError message={lockLeft > 0 ? `Аккаунт заблокирован. Повторите через ${lockLeft} с.` : formError} />

        <Field
          label="Логин"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoComplete="username"
          textContentType="username"
          maxLength={24}
          error={errors.username}
          placeholder="например, aragorn"
        />
        <Field
          label="Пароль"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          maxLength={64}
          error={errors.password}
          onSubmitEditing={submit}
          placeholder="••••••••"
        />
        <Button title="Войти" icon="🗝️" onPress={submit} loading={busy} disabled={lockLeft > 0} />

        <View style={styles.footer}>
          <Muted>Нет аккаунта? </Muted>
          <Link href="/register" style={styles.link}>
            Создать
          </Link>
        </View>
        <Muted style={styles.note}>
          🔒 Все данные хранятся только на этом устройстве. Пароль хранится в виде хэша PBKDF2 и не может быть прочитан.
        </Muted>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: space.xxl, marginBottom: space.xl },
  logo: { width: 96, height: 96 },
  brand: { color: colors.gold, fontSize: 40, fontFamily: fonts.serif, fontWeight: '700', marginTop: space.sm },
  tagline: { textAlign: 'center', marginTop: space.sm, maxWidth: 300 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: space.lg },
  link: { color: colors.gold, fontWeight: '700', fontSize: 14 },
  note: { textAlign: 'center', marginTop: space.xl, fontSize: 12 },
});
