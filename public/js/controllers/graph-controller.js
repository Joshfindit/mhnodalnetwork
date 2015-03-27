(function () {
'use strict';

NN.GraphController = Ember.ObjectController.extend({
  actions: {
    selectNode: function(node) {
      this.transitionToRoute('node', node.id);
    },
    newNode: function(nodeName) {
      var _this = this;
      console.log('create node', nodeName);
      this.createNewNode(nodeName)
        .then(function(newNode) {
          _this.transitionToRoute('node', newNode.id);
        }
      );
    },
  },
  selectedId: function() {
    return this.get('selectedNode.id');
  }.property('selectedNode'),
  createNewNode: function(nodeName) {
    // Returns: promise for the new node
    var _this = this;
    return this.store.createRecord('node', { name: nodeName }).save()
      .then(function(newNode) {
          _this.get('nodes').addObject(newNode);
          _this.get('model').save();
          _this.model.save();
          return newNode;
        }
      );
  },
  save: function() {
    if (this.get('isDirty')) {
      this.get('model').save();
    }
  },
  autoSave: function() {
    Ember.run.debounce(this, this.save, 1500);
  }.observes('name', 'desc')
});

NN.ModalDialogComponent = Ember.Component.extend({
  actions: {
    close: function() {
      this.$('.modal').modal('hide');
      this.sendAction('close');
    }
  },
  show: function() {
    this.$('.modal').modal().on('hidden.bs.modal', function() {
      this.sendAction('close');
    }.bind(this));
  }.on('didInsertElement')
});

})();