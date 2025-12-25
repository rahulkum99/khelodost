const router = require('express').Router();
const userController = require('./user.controller');

router.get('/cricket', userController.getCricketMatches);

module.exports = router;
