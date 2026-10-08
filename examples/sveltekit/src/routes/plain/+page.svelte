<script lang="ts">
  import { page } from '$app/state';
  let locale = $derived(page.url.searchParams.get('locale') ?? 'ko');
</script>

<svelte:head><title>Saylo · layout 종료</title></svelte:head>
<main id="plain-page" lang="ko">
  <h1>번역 화면을 나왔습니다.</h1>
  <p>이 페이지는 Saylo context를 사용하지 않습니다. 이전 번역 layout의 연결과 instance는 해제됩니다.</p>
  <a id="return-link" href="/?locale={encodeURIComponent(locale)}">번역 화면으로 돌아가기</a>
</main>
