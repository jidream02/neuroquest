import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { listCampaigns, listCharacters, type CampaignStatus } from '../../db/repo';
import { classById } from '../../lib/rules';
import { useSession } from '../../services/AuthContext';
import { Badge, Button, Card, EmptyState, FormError, Loading, Muted, Screen, Spacer, Title } from '../../ui/components';
import { colors, fonts, space } from '../../ui/theme';
import { useLoad } from '../../ui/useLoad';

const STATUS: Record<CampaignStatus, { text: string; color: string }> = {
  active: { text: 'идёт', color: colors.purpleDark },
  dead: { text: 'герой пал', color: '#5A2230' },
  finished: { text: 'завершено', color: '#24502F' },
};

export default function CampaignsScreen() {
  const db = useSQLiteContext();
  const { userId, username } = useSession();
  const { data, error, loading } = useLoad(useCallback(async () => {
    const [campaigns, heroes] = await Promise.all([listCampaigns(db, userId), listCharacters(db, userId)]);
    return { campaigns, heroCount: heroes.length };
  }, [db, userId]));

  if (loading) return <Loading />;
  const campaigns = data?.campaigns ?? [];

  return (
    <Screen>
      <Title>Привет, {username}!</Title>
      <Muted>Выберите приключение или начните новое — мастер уже ждёт.</Muted>
      <Spacer />
      <FormError message={error} />

      {data && data.heroCount === 0 ? (
        <EmptyState
          icon="🛡️"
          title="Сначала создайте героя"
          text="Приключению нужен герой. Это займёт минуту."
          action={<Button title="Создать героя" icon="✨" onPress={() => router.push('/hero/new')} />}
        />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon="🗺️"
          title="Приключений пока нет"
          text="Выберите героя и мир — ИИ-мастер придумает сюжет."
          action={<Button title="Новое приключение" icon="⚔️" onPress={() => router.push('/campaign/new')} />}
        />
      ) : (
        <>
          <Button title="Новое приключение" icon="⚔️" onPress={() => router.push('/campaign/new')} />
          <Spacer />
          {campaigns.map((c) => (
            <Card key={c.id} onPress={() => router.push(`/play/${c.id}`)}>
              <View style={styles.top}>
                <Text style={styles.title} numberOfLines={1}>
                  {c.title}
                </Text>
                <Badge text={STATUS[c.status].text} color={STATUS[c.status].color} />
              </View>
              <Muted>
                {classById(c.hero_class).emoji} {c.hero_name}, {c.hero_level} ур. · ходов: {c.turns}
              </Muted>
              {c.summary ? (
                <Text style={styles.summary} numberOfLines={2}>
                  {c.summary}
                </Text>
              ) : null}
              <View style={styles.bottom}>
                <Muted style={styles.date}>{new Date(c.updated_at).toLocaleString()}</Muted>
                <Text style={styles.edit} onPress={() => router.push(`/campaign/${c.id}/edit`)} accessibilityRole="link">
                  ✏️ Изменить
                </Text>
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: 4 },
  title: { color: colors.text, fontSize: 18, fontFamily: fonts.serif, fontWeight: '700', flex: 1 },
  summary: { color: colors.text, opacity: 0.8, marginTop: space.sm, fontStyle: 'italic', lineHeight: 20 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  date: { fontSize: 12 },
  edit: { color: colors.gold, fontWeight: '700', fontSize: 13, padding: 4 },
});
