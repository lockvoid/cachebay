<script setup lang="ts">
  import { useFragment } from "cachebay/vue" ;
  import { HOGWARTS_TIME_FIELDS } from "~/composables/useHogwartsTime";

  useHogwartsTime();

  // You can use either useQuery or useFragment. Both will be synchronized with the subscription.

  const hogwartsTime = useFragment({ id: "HogwartsTime:1", fragment: HOGWARTS_TIME_FIELDS });

  watch(hogwartsTime, (newTime) => {
    console.log(newTime);
  });

  const timeFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit",  hour12: false });
</script>

<template>
  <div v-if="hogwartsTime" class="flex items-center text-xs">
    Hogwarts time: {{ hogwartsTime.time ? timeFormatter.format(new Date(hogwartsTime.time)) : "" }}
  </div>
</template>
