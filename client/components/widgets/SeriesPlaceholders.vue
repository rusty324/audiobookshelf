<template>
  <div v-if="show" class="w-full px-4e sm:px-8e py-8e">
    <div class="flex items-center mb-4e">
      <p class="text-1.2e font-semibold">{{ $strings.HeaderNotInLibrary }}</p>
      <div class="w-6e" />
      <p v-if="placeholders.length" class="text-0.9e text-gray-400">{{ placeholders.length }}</p>
      <div class="grow" />
      <ui-btn v-if="canUpdate && !showAddForm" small color="bg-primary" @click="showAddForm = true">{{ $strings.ButtonAddMissingBook }}</ui-btn>
    </div>

    <p class="text-0.85e text-gray-400 mb-4e">{{ $strings.MessageSeriesPlaceholdersHelp }}</p>

    <!-- Add / edit form -->
    <div v-if="showAddForm" class="w-full bg-primary/40 border border-white/10 rounded p-4e mb-4e">
      <div class="flex flex-wrap -mx-1e">
        <div class="px-1e w-full sm:w-1/2 mb-2e">
          <ui-text-input-with-label ref="titleInput" v-model="form.title" :label="$strings.LabelTitle" />
        </div>
        <div class="px-1e w-1/2 sm:w-1/4 mb-2e">
          <ui-text-input-with-label v-model="form.sequence" :label="$strings.LabelSequence" />
        </div>
        <div class="px-1e w-1/2 sm:w-1/4 mb-2e">
          <ui-text-input-with-label v-model="form.authorName" :label="$strings.LabelAuthor" />
        </div>
      </div>
      <div class="flex justify-end items-center pt-2e">
        <ui-btn small color="bg-primary" class="mr-2e" @click="cancelForm">{{ $strings.ButtonCancel }}</ui-btn>
        <ui-btn small color="bg-success" :loading="saving" @click="submitForm">{{ $strings.ButtonSave }}</ui-btn>
      </div>
    </div>

    <p v-if="!placeholders.length && !showAddForm" class="text-0.9e text-gray-400 italic">{{ $strings.MessageNoSeriesPlaceholders }}</p>

    <!-- Ghost entries -->
    <div v-for="placeholder in placeholders" :key="placeholder.id" class="flex items-center w-full border border-dashed border-white/20 rounded px-3e py-2e mb-2e opacity-60 hover:opacity-90 transition-opacity">
      <div class="w-8e text-center shrink-0">
        <p v-if="placeholder.sequence" class="text-0.9e font-mono">#{{ placeholder.sequence }}</p>
        <span v-else class="material-symbols text-1.1e text-gray-500">help_outline</span>
      </div>
      <div class="grow px-2e min-w-0">
        <p class="text-1e truncate">{{ placeholder.title }}</p>
        <p v-if="placeholder.authorName" class="text-0.8e text-gray-400 truncate">{{ placeholder.authorName }}</p>
      </div>
      <p class="text-0.75e text-gray-400 uppercase tracking-wide shrink-0 px-2e hidden sm:block">{{ $strings.LabelNotInLibrary }}</p>
      <div v-if="canUpdate" class="flex items-center shrink-0">
        <ui-icon-btn icon="edit" borderless :size="7" icon-font-size="1.1rem" :aria-label="$strings.ButtonEdit" @click="editPlaceholder(placeholder)" />
        <ui-icon-btn icon="close" borderless :size="7" icon-font-size="1.1rem" :aria-label="$strings.ButtonRemove" @click="removePlaceholder(placeholder)" />
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    seriesId: String
  },
  data() {
    return {
      placeholders: [],
      loaded: false,
      saving: false,
      showAddForm: false,
      editingId: null,
      form: {
        title: '',
        sequence: '',
        authorName: ''
      }
    }
  },
  computed: {
    canUpdate() {
      return this.$store.getters['user/getUserCanUpdate']
    },
    show() {
      // Stay out of the way until there is something to show or something to do
      return this.loaded && (this.placeholders.length > 0 || this.canUpdate)
    }
  },
  methods: {
    async loadPlaceholders() {
      if (!this.seriesId) return
      const data = await this.$axios.$get(`/api/series/${this.seriesId}/placeholders`).catch((error) => {
        console.error('Failed to load series placeholders', error)
        return null
      })
      this.placeholders = data?.placeholders || []
      this.loaded = true
    },
    resetForm() {
      this.form.title = ''
      this.form.sequence = ''
      this.form.authorName = ''
      this.editingId = null
    },
    cancelForm() {
      this.showAddForm = false
      this.resetForm()
    },
    editPlaceholder(placeholder) {
      this.editingId = placeholder.id
      this.form.title = placeholder.title
      this.form.sequence = placeholder.sequence || ''
      this.form.authorName = placeholder.authorName || ''
      this.showAddForm = true
    },
    async submitForm() {
      const title = (this.form.title || '').trim()
      if (!title) {
        this.$toast.error(this.$strings.ToastTitleRequired)
        return
      }
      this.saving = true
      const payload = {
        title,
        sequence: (this.form.sequence || '').trim(),
        authorName: (this.form.authorName || '').trim()
      }
      const request = this.editingId ? this.$axios.$patch(`/api/series/${this.seriesId}/placeholders/${this.editingId}`, payload) : this.$axios.$post(`/api/series/${this.seriesId}/placeholders`, payload)

      const result = await request.catch((error) => {
        // 409 carries a specific reason worth showing rather than a generic failure
        const message = error.response?.status === 409 ? error.response.data : this.$strings.ToastSeriesPlaceholderFailed
        this.$toast.error(message || this.$strings.ToastSeriesPlaceholderFailed)
        return null
      })
      this.saving = false
      if (!result) return

      this.cancelForm()
      await this.loadPlaceholders()
    },
    async removePlaceholder(placeholder) {
      const payload = {
        message: this.$getString('MessageConfirmRemoveSeriesPlaceholder', [placeholder.title]),
        callback: async (confirmed) => {
          if (!confirmed) return
          const success = await this.$axios
            .$delete(`/api/series/${this.seriesId}/placeholders/${placeholder.id}`)
            .then(() => true)
            .catch((error) => {
              console.error('Failed to remove series placeholder', error)
              this.$toast.error(this.$strings.ToastSeriesPlaceholderFailed)
              return false
            })
          if (success) await this.loadPlaceholders()
        },
        type: 'yesNo'
      }
      this.$store.commit('globals/setConfirmPrompt', payload)
    }
  },
  mounted() {
    this.loadPlaceholders()
  },
  watch: {
    seriesId() {
      this.loaded = false
      this.placeholders = []
      this.cancelForm()
      this.loadPlaceholders()
    }
  }
}
</script>
