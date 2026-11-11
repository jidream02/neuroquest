import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ABILITIES } from '../../../../shared/dmProtocol';
import * as repo from '../../../db/repo';
import {
  ABILITY_LABELS, XP_THRESHOLDS, classById, effectiveAbilities, formatMod, modifier, proficiencyBonus, raceById,
} from '../../../lib/rules';
import { fieldErrors, itemSchema } from '../../../lib/validation';
import { useSession } from '../../../services/AuthContext';
import {
  Bar, Button, Card, EmptyState, Field, FormError, Loading, Muted, Row, Screen, SectionTitle, Spacer,
} from '../../../ui/components';
import { confirmAsync, errorMessage, notify } from '../../../ui/dialogs';
import { parseId } from '../../../ui/params';
import { colors, fonts, radius, space } from '../../../ui/theme';
import { useLoad } from '../../../ui/useLoad';

export default function HeroSheetScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const id = parseId(useLocalSearchParams<{ id: string }>().id);

  const { data, loading, error, reload } = useLoad(useCallback(async () => {
    if (!id) return null;
    const hero = await repo.getCharacter(db, userId, id);
    if (!hero) return null;
    return { hero, items: await repo.listItems(db, userId, id) };
  }, [db, userId, id]));

  if (loading) return <Loading />;
  if (!data || !id) {
    return (
      <Screen>
        <EmptyState icon="❓" title="Герой не найден" text={error ?? 'Возможно, он удалён или принадлежит другому игроку.'} />
      </Screen>
    );
  }

  const { hero, items } = data;
  const race = raceById(hero.race_id);
  const cls = classById(hero.class_id);
  const eff = effectiveAbilities(repo.baseAbilities(hero), hero.race_id);
  const nextXp = XP_THRESHOLDS[hero.level] ?? hero.xp;
  const prevXp = XP_THRESHOLDS[hero.level - 1] ?? 0;

  const remove = async () => {
    const ok = await confirmAsync(
      'Удалить героя?',
      `${hero.name} и все его приключения будут удалены безвозвратно. Сделайте бэкап, если не уверены.`,
      'Удалить',
      true,
    );
    if (!ok) return;
    try {
      await repo.deleteCharacter(db, userId, id);
      router.back();
    } catch (e) {
      notify('Ошибка', errorMessage(e));
    }
  };

  const rest = async () => {
    await repo.restCharacter(db, userId, id);
    await reload();
    notify('Долгий отдых', `${hero.name} восстанавливает все силы. HP: ${hero.max_hp}/${hero.max_hp}`);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: hero.name }} />
      <Card>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={{ fontSize: 34 }}>{cls.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{hero.name}</Text>
            <Muted>
              {race.emoji} {race.name} · {cls.name} · уровень {hero.level}
            </Muted>
            <Muted>Бонус мастерства {formatMod(proficiencyBonus(hero.level))}</Muted>
          </View>
        </View>
        <Spacer />
        <Bar label="❤️ Здоровье" value={hero.hp} max={hero.max_hp} color={colors.danger} />
        <Spacer h={space.sm} />
        <Bar
          label={`⭐ Опыт (${hero.xp} XP)`}
          value={hero.xp - prevXp}
          max={Math.max(1, nextXp - prevXp)}
          color={colors.gold}
        />
      </Card>

      <View style={styles.grid}>
        {ABILITIES.map((k) => (
          <View key={k} style={[styles.stat, cls.primary === k && styles.statPrimary]}>
            <Text style={styles.statLabel}>{ABILITY_LABELS[k].short}</Text>
            <Text style={styles.statValue}>{eff[k]}</Text>
            <Text style={styles.statMod}>{formatMod(modifier(eff[k]))}</Text>
          </View>
        ))}
      </View>

      {hero.backstory ? (
        <>
          <SectionTitle>Предыстория</SectionTitle>
          <Card>
            <Text style={styles.backstory}>{hero.backstory}</Text>
          </Card>
        </>
      ) : null}

      <SectionTitle>Инвентарь ({items.length})</SectionTitle>
      <Inventory characterId={id} items={items} onChange={reload} />

      <SectionTitle>Действия</SectionTitle>
      <Button
        title="В приключение"
        icon="⚔️"
        onPress={() => router.push(`/campaign/new?heroId=${id}`)}
        disabled={hero.hp === 0}
      />
      {hero.hp === 0 ? <Muted>Герой без сознания — сначала отдохните.</Muted> : null}
      <Spacer h={space.sm} />
      <Row>
        <Button style={{ flex: 1 }} variant="secondary" title="Изменить" icon="✏️" onPress={() => router.push(`/hero/${id}/edit`)} />
        <Button style={{ flex: 1 }} variant="secondary" title="Отдых" icon="🏕️" onPress={rest} disabled={hero.hp === hero.max_hp} />
      </Row>
      <Spacer />
      <Button variant="danger" title="Удалить героя" icon="🗑️" onPress={remove} />
    </Screen>
  );
}

// ---------- Инвентарь: добавление, редактирование, удаление ----------

function Inventory({ characterId, items, onChange }: { characterId: number; items: repo.ItemRow[]; onChange: () => Promise<void> }) {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const open = (item?: repo.ItemRow) => {
    setEditing(item ? item.id : 'new');
    setName(item?.name ?? '');
    setQty(String(item?.qty ?? 1));
    setErrors({});
    setFormError(null);
  };

  const save = async () => {
    const parsed = itemSchema.safeParse({ name, qty: /^\d+$/.test(qty.trim()) ? Number(qty) : NaN });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    try {
      if (editing === 'new') await repo.addItem(db, userId, characterId, parsed.data.name, parsed.data.qty);
      else if (editing) await repo.updateItem(db, userId, editing, parsed.data.name, parsed.data.qty);
      setEditing(null);
      await onChange();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const remove = async (item: repo.ItemRow) => {
    if (!(await confirmAsync('Выбросить предмет?', `«${item.name}» будет удалён из инвентаря.`, 'Удалить', true))) return;
    try {
      await repo.deleteItem(db, userId, item.id);
      setEditing(null);
      await onChange();
    } catch (e) {
      notify('Ошибка', errorMessage(e));
    }
  };

  const editor = (
    <Card style={styles.editor}>
      <FormError message={formError} />
      <Field label="Предмет" value={name} onChangeText={setName} maxLength={40} error={errors.name} autoFocus />
      <Field label="Количество" value={qty} onChangeText={setQty} keyboardType="number-pad" maxLength={3} error={errors.qty} />
      <Row>
        <Button small style={{ flex: 1 }} title="Сохранить" onPress={save} />
        <Button small style={{ flex: 1 }} variant="secondary" title="Отмена" onPress={() => setEditing(null)} />
      </Row>
    </Card>
  );

  return (
    <View>
      {items.length === 0 && editing !== 'new' ? <Muted>Сумка пуста.</Muted> : null}
      {items.map((it) =>
        editing === it.id ? (
          <View key={it.id}>{editor}</View>
        ) : (
          <View key={it.id} style={styles.item}>
            <Pressable style={{ flex: 1 }} onPress={() => open(it)} accessibilityLabel={`Изменить ${it.name}`}>
              <Text style={styles.itemName}>
                {it.name}
                {it.qty > 1 ? <Text style={styles.itemQty}> ×{it.qty}</Text> : null}
              </Text>
            </Pressable>
            <Pressable onPress={() => open(it)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Изменить">
              <Text>✏️</Text>
            </Pressable>
            <Pressable onPress={() => remove(it)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Удалить">
              <Text>🗑️</Text>
            </Pressable>
          </View>
        ),
      )}
      <Spacer h={space.sm} />
      {editing === 'new' ? editor : <Button small variant="secondary" title="Добавить предмет" icon="➕" onPress={() => open()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.purpleDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.gold,
  },
  name: { color: colors.gold, fontSize: 24, fontFamily: fonts.serif, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'space-between' },
  stat: {
    width: '31%', backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  statPrimary: { borderColor: colors.gold },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '800', fontFamily: fonts.serif },
  statMod: { color: colors.gold, fontSize: 14, fontWeight: '700' },
  backstory: { color: colors.text, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md,
    paddingVertical: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.border, gap: space.sm,
  },
  itemName: { color: colors.text, fontSize: 15 },
  itemQty: { color: colors.gold, fontWeight: '700' },
  iconBtn: { padding: 4 },
  editor: { borderColor: colors.gold },
});
