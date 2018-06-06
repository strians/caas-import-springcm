const _ = require('lodash');
const matcher = require('matcher');

module.exports = (filter, documents) => {
  var inFilter = _.get(filter, 'in');
  var outFilter = _.get(filter, 'out');

  if (_.isArray(inFilter)) {
    documents = _.filter(documents, (doc) => {
      for (var i = 0; i < inFilter.length; ++i) {
        if (matcher.isMatch(doc.getName(), inFilter[i])) {
          return true;
        }
      }

      return false;
    });
  } else if (_.isString(inFilter)) {
    documents = _.filter(documents, (doc) => matcher.isMatch(doc.getName(), inFilter));
  }

  if (_.isArray(outFilter)) {
    documents = _.filter(documents, (doc) => {
      for (var i = 0; i < outFilter.length; ++i) {
        if (matcher.isMatch(doc.getName(), outFilter[i])) {
          return false;
        }
      }

      return true;
    });
  } else {
    documents = _.filter(documents, (doc) => !matcher.isMatch(doc.getName(), inFilter));
  }

  return documents;
};
