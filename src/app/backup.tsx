import React, { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { backupPasswordSchema } from '../lib/validation';
import { useSession } from '../services/AuthContext';
import * as backup from '../services/backup';
import { Button, Card, Field, FormError, Muted, Screen, SectionTitle, Spacer } from '../ui/components';
import { confirmAsync, errorMessage, notify } from '../ui/dialogs';
import { colors, radius, space } from '../ui/theme';
import { useLoad } from '../ui/useLoad';

const isWeb = Platform.OS === 'web';

const countsText = (c: { characters: number; items: number; campaigns: number; messages: number }) =>
  `героев: ${c.characters}, предметов: ${c.items}, приключений: ${c.campaigns}, сообщений: ${c.messages}`;

export default function BackupScreen() {
  const db = useSQLiteContext();
  const { userId, username } = useSession();
  const { data: files, reload } = useLoad(useCallback(async () => backup.listLocalBackups(), []));

  // --- создание ---
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // --- восстановление ---
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const create = async () => {
    setCreateErr(null);
    setLastResult(null);
    const parsed = backupPasswordSchema.safeParse(pw);
    if (!parsed.success) return setCreateErr(parsed.error.issues[0].message);
    if (pw !== pw2) return setCreateErr('Пароли не совпадают');
    setCreating(true);
    try {
      const r = await backup.createBackup(db, userId, username, pw);
      setPw('');
      setPw2('');
      setLastResult(`✅ ${r.fileName}\nПроверка пройдена: ${countsText(r.counts)}. Размер ${(r.bytes / 1024).toFixed(1)} КБ.`);
      await reload();
    } catch (e) {
      setCreateErr(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const pick = async () => {
    setRestoreErr(null);
    try {
      const f = await backup.pickBackupFile();
      if (f) setSource(f);
    } catch (e) {
      setRestoreErr(errorMessage(e));
    }
  };

  const chooseLocal = async (f: backup.LocalBackup) => {
    setRestoreErr(null);
    try {
      setSource({ name: f.name, text: await backup.readLocalBackup(f.uri) });
    } catch (e) {
      setRestoreErr(errorMessage(e));
    }
  };

  const restore = async () => {
    if (!source) return;
    setRestoreErr(null);
    if (!restorePw) return setRestoreErr('Введите пароль бэкапа');
    const ok = await confirmAsync(
      'Восстановить данные?',
      'Текущие герои и приключения будут ЗАМЕНЕНЫ данными из резервной копии.',
      'Восстановить',
      true,
    );
    if (!ok) return;
    setRestoring(true);
    try {
      const r = await backup.restoreBackup(db, userId, source.text, restorePw);
      setRestorePw('');
      setSource(null);
      notify('Данные восстановлены', `Копия от ${r.from}.\nПроверка пройдена: ${countsText(r.counts)}.`);
    } catch (e) {
      setRestoreErr(errorMessage(e));
    } finally {
      setRestoring(false);
    }
  };

  const removeFile = async (f: backup.LocalBackup) => {
    if (!(await confirmAsync('Удалить файл?', f.name, 'Удалить', true))) return;
    backup.deleteLocalBackup(f.uri);
    await reload();
  };

  return (
    <Screen>
      <Card style={styles.info}>
        <Text style={styles.infoText}>
          🔐 Копия шифруется алгоритмом AES-256-GCM. Ключ получается из вашего пароля (PBKDF2, 60 000 итераций). Без пароля
          файл прочитать нельзя, а любое изменение файла будет обнаружено.
        </Text>
      </Card>

      <SectionTitle>Создать резервную копию</SectionTitle>
      <FormError message={createErr} />
      <Field label="Пароль для копии" value={pw} onChangeText={setPw} secureTextEntry maxLength={64} hint="Минимум 6 символов. Запомните его — восстановить пароль нельзя." />
      <Field label="Повторите пароль" value={pw2} onChangeText={setPw2} secureTextEntry maxLength={64} />
      <Button title={isWeb ? 'Создать и скачать' : 'Создать копию'} icon="💾" onPress={create} loading={creating} />
      {lastResult ? (
        <Card style={styles.ok}>
          <Text style={styles.okText}>{lastResult}</Text>
        </Card>
      ) : null}

      {!isWeb ? (
        <>
          <SectionTitle>Копии на устройстве ({files?.length ?? 0})</SectionTitle>
          {files?.length === 0 ? <Muted>Пока нет сохранённых копий.</Muted> : null}
          {files?.map((f) => (
            <View key={f.uri} style={[styles.file, source?.name === f.name && styles.fileActive]}>
              <Pressable style={{ flex: 1 }} onPress={() => chooseLocal(f)}>
                <Text style={styles.fileName}>{f.name}</Text>
                <Muted style={{ fontSize: 12 }}>{(f.size / 1024).toFixed(1)} КБ · нажмите, чтобы выбрать для восстановления</Muted>
              </Pressable>
              <Pressable onPress={() => backup.shareBackup(f.uri).catch((e) => notify('Ошибка', errorMessage(e)))} hitSlop={8} style={styles.iconBtn}>
                <Text>📤</Text>
              </Pressable>
              <Pressable onPress={() => removeFile(f)} hitSlop={8} style={styles.iconBtn}>
                <Text>🗑️</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      <SectionTitle>Восстановить из копии</SectionTitle>
      <Button variant="secondary" title="Выбрать файл .nqbak" icon="📂" onPress={pick} />
      <Spacer h={space.sm} />
      {source ? (
        <Card>
          <Text style={styles.fileName}>📄 {source.name}</Text>
          <Spacer h={space.sm} />
          <FormError message={restoreErr} />
          <Field label="Пароль копии" value={restorePw} onChangeText={setRestorePw} secureTextEntry maxLength={64} />
          <Button title="Восстановить" icon="♻️" onPress={restore} loading={restoring} />
        </Card>
      ) : (
        <>
          <FormError message={restoreErr} />
          <Muted>Выберите файл копии, затем введите её пароль.</Muted>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { backgroundColor: colors.surfaceAlt },
  infoText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  ok: { marginTop: space.md, borderColor: colors.success },
  okText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  file: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    marginBottom: 6, borderWidth: 1, borderColor: colors.border, gap: space.sm,
  },
  fileActive: { borderColor: colors.gold },
  fileName: { color: colors.text, fontWeight: '600', fontSize: 14 },
  iconBtn: { padding: 4 },
});
