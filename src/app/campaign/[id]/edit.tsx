import React, { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteCampaign, getCampaign, renameCampaign, type CampaignRow } from '../../../db/repo';
import { campaignSchema, fieldErrors } from '../../../lib/validation';
import { useSession } from '../../../services/AuthContext';
import { Button, Card, EmptyState, Field, FormError, Loading, Muted, Screen, SectionTitle, Spacer } from '../../../ui/components';
import { confirmAsync, errorMessage } from '../../../ui/dialogs';
import { parseId } from '../../../ui/params';
import { useLoad } from '../../../ui/useLoad';

export default function EditCampaignScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const id = parseId(useLocalSearchParams<{ id: string }>().id);
  const { data: campaign, loading } = useLoad(
    useCallback(() => (id ? getCampaign(db, userId, id) : Promise.resolve(null)), [db, userId, id]),
  );

  if (loading) return <Loading />;
  if (!campaign) return <EmptyState icon="❓" title="Приключение не найдено" text="Возможно, оно удалено." />;
  return <EditForm campaign={campaign} />;
}

function EditForm({ campaign }: { campaign: CampaignRow }) {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const [title, setTitle] = useState(campaign.title);
  const [setting, setSetting] = useState(campaign.setting);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = async () => {
    const parsed = campaignSchema.safeParse({ title, setting, characterId: campaign.character_id });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    try {
      await renameCampaign(db, userId, campaign.id, parsed.data.title, parsed.data.setting);
      router.back();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!(await confirmAsync('Удалить приключение?', `«${campaign.title}» и вся история ходов будут удалены.`, 'Удалить', true))) return;
    try {
      await deleteCampaign(db, userId, campaign.id);
      router.back();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  return (
    <Screen>
      <FormError message={formError} />
      <Field label="Название" value={title} onChangeText={setTitle} maxLength={60} error={errors.title} />
      <Field label="Описание мира" value={setting} onChangeText={setSetting} multiline maxLength={400} error={errors.setting} hint={`${setting.length}/400`} />
      <Button title="Сохранить" icon="💾" onPress={save} />

      {campaign.summary ? (
        <>
          <SectionTitle>Летопись (память мастера)</SectionTitle>
          <Card>
            <Muted>{campaign.summary}</Muted>
          </Card>
        </>
      ) : null}
      <Spacer />
      <Button variant="danger" title="Удалить приключение" icon="🗑️" onPress={remove} />
    </Screen>
  );
}
