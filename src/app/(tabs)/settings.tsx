import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { countUserData } from '../../db/repo';
import { useAuth, useSession } from '../../services/AuthContext';
import { apiBaseUrl, checkHealth, isCustomServerUrl, setServerUrl } from '../../services/dmApi';
import { Button, Card, Field, Muted, Row, Screen, SectionTitle, Spacer, Title } from '../../ui/components';
import { confirmAsync, errorMessage } from '../../ui/dialogs';
import { colors, space } from '../../ui/theme';
import { useLoad } from '../../ui/useLoad';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { userId, username } = useSession();
  const { signOut } = useAuth();
  const [url, setUrl] = useState(isCustomServerUrl() ? apiBaseUrl() : '');
  const [urlError, setUrlError] = useState<string | undefined>();
  const { data, reload } = useLoad(useCallback(async () => {
    const [counts, health] = await Promise.all([countUserData(db, userId), checkHealth()]);
    return { counts, health };
  }, [db, userId]));

  const logout = async () => {
    if (await confirmAsync('Выйти?', 'Для входа снова понадобится пароль.', 'Выйти')) await signOut('logout');
  };

  const saveUrl = async (value: string) => {
    setUrlError(undefined);
    try {
      await setServerUrl(value);
      setUrl(value.trim() ? apiBaseUrl() : '');
      await reload();
    } catch (e) {
      // ZodError → первое сообщение схемы
      const issues = (e as { issues?: { message: string }[] }).issues;
      setUrlError(issues?.[0]?.message ?? errorMessage(e));
    }
  };

  const h = data?.health;
  const serverText = !h ? '…' : !h.ok ? '🔴 недоступен' : h.ai ? '🟢 ИИ-мастер (Gemini)' : '🟡 офлайн-мастер (без ИИ)';

  return (
    <Screen>
      <Title>👤 {username}</Title>
      <Muted>Локальный аккаунт на этом устройстве</Muted>

      <SectionTitle>Мои данные</SectionTitle>
      <Card>
        <View style={styles.stats}>
          <Stat n={data?.counts.characters} label="героев" />
          <Stat n={data?.counts.campaigns} label="приключений" />
          <Stat n={data?.counts.items} label="предметов" />
          <Stat n={data?.counts.messages} label="ходов" />
        </View>
      </Card>

      <SectionTitle>Сервер мастера</SectionTitle>
      <Card>
        <Text style={styles.server}>{serverText}</Text>
        <Muted style={styles.small}>{apiBaseUrl()}</Muted>
        {h && !h.ok ? (
          <Muted style={[styles.small, { marginTop: 6 }]}>Без сервера играет встроенный офлайн-мастер.</Muted>
        ) : null}
        <Spacer h={space.md} />
        <Field
          label="Свой адрес сервера (необязательно)"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          maxLength={200}
          placeholder="http://192.168.1.10:8787"
          error={urlError}
        />
        <Row>
          <Button small style={{ flex: 1 }} title="Сохранить" onPress={() => saveUrl(url)} />
          <Button small style={{ flex: 1 }} variant="secondary" title="Авто" onPress={() => saveUrl('')} />
        </Row>
      </Card>

      <SectionTitle>Данные и безопасность</SectionTitle>
      <Button variant="secondary" title="Резервные копии" icon="💾" onPress={() => router.push('/backup')} />
      <Spacer h={space.sm} />
      <Button variant="secondary" title="Безопасность и журнал входов" icon="🔐" onPress={() => router.push('/security')} />
      <Spacer h={space.xl} />
      <Button variant="danger" title="Выйти из аккаунта" icon="🚪" onPress={logout} />
      <Spacer />
      <Muted style={styles.footer}>NeuroQuest 1.0 · React Native + Expo</Muted>
    </Screen>
  );
}

function Stat({ n, label }: { n?: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n ?? '–'}</Text>
      <Muted style={styles.small}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statN: { color: colors.gold, fontSize: 24, fontWeight: '800' },
  small: { fontSize: 12 },
  server: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  footer: { textAlign: 'center', fontSize: 12 },
});
