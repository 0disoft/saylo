<script lang="ts">
  import { getI18n } from '#lib/i18n.ts';
  const i18n = getI18n();
</script>

<section class="intro">
  <p class="eyebrow">SVELTEKIT LIVE CATALOG PREVIEW</p>
  <h1>{$i18n.t('demo:heading')}</h1>
  <p>{$i18n.t('demo:description')}</p>
  <p class="hint">입력과 확인 창은 공통 layout에 두어 페이지를 이동해도 유지합니다.</p>
</section>
