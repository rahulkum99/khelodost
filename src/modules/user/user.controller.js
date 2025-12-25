const { getLatestCricketData } = require('../../services/cricket.service');

exports.getCricketMatches = (req, res) => {
  res.json(getLatestCricketData());
  
};