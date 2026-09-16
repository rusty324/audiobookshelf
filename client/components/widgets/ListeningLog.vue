<template>
  <div v-if="events.length || loading" class="w-full mt-4">
    <div class="flex items-center cursor-pointer max-w-max" @click="expanded = !expanded">
      <p class="text-sm font-semibold">{{ $strings.HeaderListeningLog }}</p>
      <span class="material-symbols text-lg ml-1" :class="expanded ? 'rotate-180' : ''">expand_more</span>
    </div>

    <div v-if="expanded" class="mt-2">
      <div v-for="group in groupedEvents" :key="group.date" class="mb-3">
        <p class="text-xs font-semibold text-gray-400 pb-1">{{ group.date }}</p>

        <div v-for="event in group.events" :key="event.id" class="bg-primary/40 rounded-md px-3 py-2 mb-1 flex items-center justify-between">
          <div class="min-w-0 pr-2">
            <p class="text-sm">{{ eventLabel(event) }}</p>
            <p v-if="event.chapterTitle" class="text-xs text-gray-400 truncate">{{ event.chapterTitle }}</p>
            <p v-if="event.fromTime !== null" class="text-xs text-gray-500">{{ $strings.LabelPreviousPlace }}: {{ $secondsToTimestamp(event.fromTime) }}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-sm font-mono">{{ $secondsToTimestamp(event.currentTime) }}</p>
            <p class="text-xs text-gray-400">{{ timeOfDay(event.createdAt) }}</p>
          </div>
        </div>
      </div>

      <div v-if="hasMore" class="flex justify-center pt-1">
        <ui-btn small :loading="loading" @click="loadMore">{{ $strings.ButtonLoadMore }}</ui-btn>
      </div>

      <p v-if="!events.length && !loading" class="text-xs text-gray-400">{{ $strings.MessageNoListeningLog }}</p>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    libraryItemId: String
  },
  data() {
    return {
      expanded: false,
      loading: false,
      events: [],
      page: 0,
      numPages: 0
    }
  },
  computed: {
    dateFormat() {
      return this.$store.getters['getServerSetting']('dateFormat')
    },
    hasMore() {
      return this.page + 1 < this.numPages
    },
    /** Events bucketed by day, matching how a listening history reads. */
    groupedEvents() {
      const groups = []
      for (const event of this.events) {
        const date = this.$formatDate(new Date(event.createdAt).valueOf(), this.dateFormat)
        const existing = groups.find((g) => g.date === date)
        if (existing) existing.events.push(event)
        else groups.push({ date, events: [event] })
      }
      return groups
    }
  },
  methods: {
    eventLabel(event) {
      const labels = {
        play: this.$strings.LabelPlaybackEventPlay,
        pause: this.$strings.LabelPlaybackEventPause,
        seek: this.$strings.LabelPlaybackEventSeek,
        chapterSkip: this.$strings.LabelPlaybackEventChapterSkip,
        finished: this.$strings.LabelPlaybackEventFinished
      }
      return labels[event.eventType] || event.eventType
    },
    timeOfDay(createdAt) {
      return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
    async loadEvents(page = 0) {
      if (!this.libraryItemId) return
      this.loading = true

      const payload = await this.$axios.$get(`/api/me/item/${this.libraryItemId}/playback-events`, { params: { page, itemsPerPage: 25 } }).catch((error) => {
        console.error('Failed to load playback events', error)
        return null
      })

      this.loading = false
      if (!payload) return

      this.events = page === 0 ? payload.events : this.events.concat(payload.events)
      this.page = payload.page
      this.numPages = payload.numPages
    },
    loadMore() {
      this.loadEvents(this.page + 1)
    }
  },
  mounted() {
    this.loadEvents(0)
  }
}
</script>
