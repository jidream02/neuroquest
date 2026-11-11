import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CharacterRow } from '../db/repo';
import { classById, raceById } from '../lib/rules';
import { Bar, Card } from './components';
import { colors, fonts, space } from './theme';

export function HeroCard({ hero, onPress, selected }: { hero: CharacterRow; onPress?: () => void; selected?: boolean }) {
  const race = raceById(hero.race_id);
  const cls = classById(hero.class_id);
  return (
    <Card onPress={onPress} style={selected ? styles.selected : undefined}>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{cls.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {hero.name}
          </Text>
          <Text style={styles.meta}>
            {race.emoji} {race.name} · {cls.name} · {hero.level} ур.
          </Text>
          <View style={{ marginTop: space.sm }}>
            <Bar value={hero.hp} max={hero.max_hp} label="❤️ HP" color={hero.hp === 0 ? colors.textMuted : colors.danger} />
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.purpleDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.goldDark,
  },
  avatarText: { fontSize: 26 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700', fontFamily: fonts.serif },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  selected: { borderColor: colors.gold, backgroundColor: colors.surfaceAlt },
});
