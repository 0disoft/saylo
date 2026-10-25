<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveLocale } from '@0disoft/saylo-core/runtime';
  import { locales } from '../lib/locales';
  onMount(() => {
    const url = new URL(location.href);
    url.pathname = `/${resolveLocale(navigator.languages, locales, 'en')}/`;
    location.replace(url);
  });
</script>

<svelte:head><title>Choose a language</title></svelte:head>
<h1>Choose a language</h1>
<nav aria-label="Languages">{#each locales as locale}<a href={`/${locale}/`} data-sveltekit-reload>{locale}</a> {/each}</nav>
