import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TurnInput } from '../../../shared/dmProtocol';
import * as repo from '../../db/repo';
import { ABILITY_LABELS, abilityCheck, classById, effectiveAbilities, type CheckResult } from '../../lib/rules';
import { actionSchema } from '../../lib/validation';
import { useSession } from '../../services/AuthContext';
import { parseDmMeta, pendingCheck, recordPlayerInput, resolveTurn } from '../../services/game';
import { Bar, Button, EmptyState, Loading } from '../../ui/components';
import { DiceRoller } from '../../ui/DiceRoller';
import { errorMessage } from '../../ui/dialogs';
import { parseId } from '../../ui/params';
import { colors, fonts, radius, space } from '../../ui/theme';

interface State {
  campaign: repo.CampaignRow;
  hero: repo.CharacterRow;
  messages: repo.MessageRow[];
}

export default function PlayScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const id = parseId(useLocalSearchParams<{ id: string }>().id);
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedInput, setFailedInput] = useState<TurnInput | null>(null);
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [roll, setRoll] = useState<CheckResult | null>(null);
  const listRef = useRef<FlatList<repo.MessageRow>>(null);

  const fetchState = useCallback(async (): Promise<State | null> => {
    if (!id) return null;
    const campaign = await repo.getCampaign(db, userId, id);
    const hero = campaign ? await repo.getCharacter(db, userId, campaign.character_id) : null;
    if (!campaign || !hero) return null;
    return { campaign, hero, messages: await repo.listMessages(db, userId, id) };
  }, [db, userId, id]);

  const load = useCallback(() => fetchState().then(setState), [fetchState]);

  useEffect(() => {
    fetchState()
      .then(setState)
      .finally(() => setLoading(false));
  }, [fetchState]);

  const play = async (input: TurnInput, record = true) => {
    if (!id || thinking) return;
    setThinking(true);
    setError(null);
    setFailedInput(null);
    try {
      if (record) {
        await recordPlayerInput(db, userId, id, input);
        await load();
      }
      await resolveTurn(db, userId, id, input);
    } catch (e) {
      setError(errorMessage(e));
      setFailedInput(input); // ход сохранён — можно повторить запрос к мастеру
    } finally {
      await load();
      setThinking(false);
    }
  };

  const sendAction = (raw: string) => {
    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message ?? 'Некорректное действие');
      return;
    }
    setInputError(null);
    setText('');
    void play({ type: 'action', text: parsed.data });
  };

  if (loading) return <Loading />;
  if (!state || !id) {
    return <EmptyState icon="❓" title="Приключение не найдено" text="Возможно, оно удалено или принадлежит другому игроку." />;
  }

  const { campaign, hero, messages } = state;
  const cls = classById(hero.class_id);
  const check = pendingCheck(messages);
  const lastDm = [...messages].reverse().find((m) => m.role === 'dm');
  const lastMeta = parseDmMeta(lastDm);
  const over = campaign.status !== 'active';
  const lastIsDm = messages.length > 0 && messages[messages.length - 1].role !== 'player' && messages[messages.length - 1].role !== 'roll';
  const options = !over && !check && !thinking && lastIsDm ? (lastMeta?.options ?? []) : [];

  const doRoll = () => {
    if (!check) return;
    const eff = effectiveAbilities(repo.baseAbilities(hero), hero.race_id);
    setRoll(abilityCheck(check.ability, check.dc, eff, hero.class_id, hero.level));
  };

  const finishRoll = () => {
    if (!roll) return;
    const r = roll;
    setRoll(null);
    void play({ type: 'roll', ability: r.ability, dc: r.dc, natural: r.natural, total: r.total, success: r.success });
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <Stack.Screen options={{ title: campaign.title }} />

      {/* Панель героя */}
      <Pressable style={styles.heroBar} onPress={() => router.push(`/hero/${hero.id}`)} accessibilityLabel="Открыть лист персонажа">
        <Text style={styles.heroEmoji}>{cls.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroName}>
            {hero.name} <Text style={styles.heroLvl}>· {hero.level} ур. · {hero.xp} XP</Text>
          </Text>
          <Bar value={hero.hp} max={hero.max_hp} color={hero.hp <= hero.max_hp / 3 ? colors.danger : colors.success} />
        </View>
        <Text style={styles.hpText}>
          ❤️ {hero.hp}/{hero.max_hp}
        </Text>
      </Pressable>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <MessageBubble m={item} />}
          ListEmptyComponent={
            <View style={styles.intro}>
              <Text style={styles.introIcon}>📜</Text>
              <Text style={styles.introTitle}>{campaign.title}</Text>
              <Text style={styles.introText}>{campaign.setting || 'Мир на выбор мастера'}</Text>
              <Button title="Начать приключение" icon="🎬" onPress={() => play({ type: 'start' }, false)} loading={thinking} />
            </View>
          }
          ListFooterComponent={
            <View>
              {thinking ? (
                <View style={styles.thinking}>
                  <ActivityIndicator color={colors.gold} />
                  <Text style={styles.thinkingText}>Мастер обдумывает ход…</Text>
                </View>
              ) : null}
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {error}</Text>
                  {failedInput ? (
                    <Button small title="Повторить" icon="🔁" onPress={() => play(failedInput, false)} />
                  ) : null}
                </View>
              ) : null}
            </View>
          }
        />

        {/* Нижняя панель: конец игры / бросок / ввод */}
        {over ? (
          <View style={styles.bottom}>
            <Text style={styles.overText}>{campaign.status === 'dead' ? '☠️ Герой пал. Эта история окончена.' : '🏆 Приключение завершено!'}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button small style={{ flex: 1 }} variant="secondary" title="Лист героя" onPress={() => router.push(`/hero/${hero.id}`)} />
              <Button small style={{ flex: 1 }} title="Новое приключение" onPress={() => router.replace('/campaign/new')} />
            </View>
          </View>
        ) : check && !thinking && !failedInput ? (
          <View style={styles.bottom}>
            <Text style={styles.checkText}>
              🎯 Проверка: <Text style={{ color: colors.gold }}>{ABILITY_LABELS[check.ability].full}</Text> · СЛ {check.dc}
            </Text>
            <Text style={styles.checkReason}>{check.reason}</Text>
            <Button title="Бросить d20" icon="🎲" onPress={doRoll} />
          </View>
        ) : messages.length > 0 ? (
          <View style={styles.bottom}>
            {options.length > 0 ? (
              <View style={styles.options}>
                {options.map((o, i) => (
                  <Pressable key={i} style={styles.option} onPress={() => sendAction(o)}>
                    <Text style={styles.optionText}>{o}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {inputError ? <Text style={styles.inputError}>{inputError}</Text> : null}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Что делает ваш герой?"
                placeholderTextColor={colors.textMuted}
                maxLength={300}
                multiline
                editable={!thinking}
                onSubmitEditing={() => sendAction(text)}
                blurOnSubmit
              />
              <Pressable
                style={[styles.send, (thinking || !text.trim()) && { opacity: 0.4 }]}
                onPress={() => sendAction(text)}
                disabled={thinking || !text.trim()}
                accessibilityLabel="Отправить действие"
              >
                <Text style={styles.sendText}>➤</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {roll ? <DiceRoller key={`${roll.natural}-${messages.length}`} result={roll} onDone={finishRoll} /> : null}
    </SafeAreaView>
  );
}

function MessageBubble({ m }: { m: repo.MessageRow }) {
  if (m.role === 'system') return <Text style={styles.system}>{m.content}</Text>;
  if (m.role === 'roll') {
    const ok = m.content.endsWith('успех');
    return (
      <View style={[styles.rollBubble, { borderColor: ok ? colors.success : colors.danger }]}>
        <Text style={styles.rollText}>🎲 {m.content}</Text>
      </View>
    );
  }
  const dm = m.role === 'dm';
  const offline = dm && parseDmMeta(m)?.model === 'offline';
  return (
    <View style={[styles.bubble, dm ? styles.dm : styles.player]}>
      {dm ? (
        <View style={styles.dmHead}>
          <Image source={require('../../../assets/images/logo.png')} style={styles.dmIcon} />
          <Text style={styles.dmLabel}>Мастер{offline ? ' · офлайн (ИИ был недоступен)' : ''}</Text>
        </View>
      ) : null}
      <Text style={[styles.text, dm && styles.dmText]}>{m.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heroBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  heroEmoji: { fontSize: 28 },
  heroName: { color: colors.text, fontWeight: '700', marginBottom: 4, fontFamily: fonts.serif },
  heroLvl: { color: colors.textMuted, fontWeight: '400', fontSize: 13 },
  hpText: { color: colors.text, fontWeight: '700', fontSize: 13 },

  list: { padding: space.md, paddingBottom: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center', flexGrow: 1 },
  bubble: { padding: space.md, borderRadius: radius.lg, marginVertical: 5, maxWidth: '92%' },
  dm: { backgroundColor: colors.dmBubble, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 4 },
  player: { backgroundColor: colors.playerBubble, alignSelf: 'flex-end', borderTopRightRadius: 4 },
  dmHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dmIcon: { width: 16, height: 16 },
  dmLabel: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  dmText: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24 },
  rollBubble: {
    alignSelf: 'center', backgroundColor: colors.rollBubble, borderWidth: 1, borderRadius: radius.md, paddingVertical: 8,
    paddingHorizontal: space.md, marginVertical: 6,
  },
  rollText: { color: colors.text, fontSize: 13, fontFamily: fonts.mono },
  system: { color: colors.gold, textAlign: 'center', fontSize: 13, marginVertical: 6, fontWeight: '600' },

  intro: { alignItems: 'center', paddingTop: space.xxl, paddingHorizontal: space.lg, gap: space.md },
  introIcon: { fontSize: 64 },
  introTitle: { color: colors.gold, fontSize: 26, fontFamily: fonts.serif, fontWeight: '700', textAlign: 'center' },
  introText: { color: colors.textMuted, textAlign: 'center', marginBottom: space.md },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  thinkingText: { color: colors.textMuted, fontStyle: 'italic' },
  errorBox: { backgroundColor: '#3A1820', borderRadius: radius.md, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.danger },
  errorText: { color: colors.text },

  bottom: { padding: space.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: space.sm },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: {
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.purple, borderRadius: radius.pill, paddingVertical: 8,
    paddingHorizontal: 14,
  },
  optionText: { color: colors.text, fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1, backgroundColor: colors.bg, color: colors.text, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: 10, maxHeight: 110, fontSize: 15,
  },
  inputError: { color: colors.danger, fontSize: 13 },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.bg, fontSize: 20, fontWeight: '900' },
  checkText: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  checkReason: { color: colors.textMuted, textAlign: 'center', fontStyle: 'italic' },
  overText: { color: colors.text, textAlign: 'center', fontSize: 16, fontFamily: fonts.serif },
});
