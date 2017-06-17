/**
 * Created by arnab on 2/11/15.
 */
import $ from 'jquery';
import moment from 'moment';
import _ from 'lodash';
import chartingRequestMap from './common/chartingRequestMap.js';
import liveapi from './common/liveapi.js';
import ohlc_handler from './common/ohlc_handler.js';
import currentPrice from './common/currentprice.js';
import indicators from './common/indicators.js';
import indicatorsArray from './indicators-config.js';
import notification from './common/notification.js';
import HMW from './common/highchartsMousewheel.js'
import {specificMarketDataSync, marketData} from './overlayManagement.js';
import {i18n} from './common/utils.js';
import './charts.scss';

// TODO: moemnt locale
// const lang = local_storage.get("i18n") ? local_storage.get("i18n").value.replace("_","-") : 'en';
// if(lang !== "en") // Load moment js locale file.
//     require(['moment-locale/'+lang]); 

const indicator_values = _.values(_.cloneDeep(indicatorsArray));
Highcharts.Chart.prototype.get_indicators = function() {
    const chart = this;
    const indicators = [];
    if (chart.series.length > 0) {
        indicator_values.forEach((ind) => {
            const id = ind.id;
            chart.series[0][id] && chart.series[0][id].forEach((entry) => {
                indicators.push({ id: id, name: ind.long_display_name, options: entry.options })
            });
        });
    }

    return indicators;
}

Highcharts.Chart.prototype.set_indicators = function(indicators) {
    const chart = this;
    if (chart.series && chart.series[0]) {
        indicators.forEach((ind) => {
            if (ind.options.onSeriesID) { //make sure that we are using the new onSeriesID value
                ind.options.onSeriesID = chart.series[0].options.id;
            }
            chart.series[0].addIndicator(ind.id, ind.options);
        });
    }
}

Highcharts.Chart.prototype.get_indicator_series = function() {
    const chart = this;
    const series = [];
    if (chart.series.length > 0) {
        indicator_values.forEach((ind) => {
            const id = ind.id;
            chart.series[0][id] && chart.series[0][id][0] && series.push({ id: id, series: chart.series[0][id] })
        });
    }
    return series;
}

Highcharts.Chart.prototype.set_indicator_series = function(series) {
    const chart = this;
    if (!chart.series || chart.series.length == 0) {
        return;
    }
    series.forEach((seri) => {
        chart.series[0][seri.id] = seri.series;
    });
}

Highcharts.Chart.prototype.get_overlay_count = function() {
    let overlayCount = 0;
    this.series.forEach((s, index) => {
        if (s.options.isInstrument && s.options.id.indexOf('navigator') == -1 && index != 0) {
            overlayCount++;
        }
    });
    return overlayCount;
}

$(() => {

    Highcharts.setOptions({
        global: {
            useUTC: true,
            canvasToolsURL: "https://code.highcharts.com/modules/canvas-tools.js"
        },
        lang: { thousandsSep: ',' } /* format numbers with comma (instead of space) */
    });
});

indicators.initHighchartIndicators(chartingRequestMap.barsTable);

export const destroy = (options) => {
    const containerIDWithHash = options.containerIDWithHash,
        timePeriod = options.timePeriod,
        instrumentCode = options.instrumentCode;
    if (!timePeriod || !instrumentCode) return;

    //granularity will be 0 for tick timePeriod
    const key = chartingRequestMap.keyFor(instrumentCode, timePeriod);
    chartingRequestMap.unregister(key, containerIDWithHash);
}

export const generate_csv = (chart, data, dialog_id) => {
    let lines = [],
        dataToBeProcessTolines = [];
    const flattenData = (d) => {
        let ret = null;
        if (_.isArray(d) && d.length > 3) {
            const time = d[0];
            ret = '"' + moment.utc(time).format('YYYY-MM-DD HH:mm') + '"' + ',' + d.slice(1, d.length).join(',');
        } //OHLC case
        else if (_.isNumber(d.high)) ret = '"' + moment.utc(d.time).format('YYYY-MM-DD HH:mm') + '"' + ',' + d.open + ',' + d.high + ',' + d.low + ',' + d.close;
        else if (_.isArray(d) && d.length > 1) ret = '"' + moment.utc(d[0]).format('YYYY-MM-DD HH:mm') + '"' + ',' + d[1]; //Tick chart case
        else if (_.isObject(d) && d.title && d.text) {
            if (d instanceof FractalUpdateObject) {
                ret = '"' + moment.utc(d.x || d.time).format('YYYY-MM-DD HH:mm') + '"' + ',' + (d.isBull ? 'UP' : d.isBear ? 'DOWN' : ' ');
            } else ret = '"' + moment.utc(d.x || d.time).format('YYYY-MM-DD HH:mm') + '"' + ',' + (d.text);
        } else if (_.isNumber(d.y)) ret = '"' + moment.utc(d.x || d.time).format('YYYY-MM-DD HH:mm') + '"' + ',' + (d.y || d.close);
        else ret = d.toString(); //Unknown case
        return ret;
    };
    chart.series.forEach((series, index) => {
        if (series.userOptions.id === 'navigator') return true;
        const newDataLines = series.userOptions.data.map((d) => {
            return flattenData(d);
        }) || [];
        if (index == 0) {
            const ohlc = newDataLines[0].split(',').length > 2;
            if (ohlc) lines.push('Date,Time,Open,High,Low,Close');
            else lines.push('Date,Time,"' + series.userOptions.name + '"');
            //newDataLines is incorrect - get it from lokijs
            const key = chartingRequestMap.keyFor(data.instrumentCode, data.timePeriod);
            const bars = chartingRequestMap.barsTable.query({ instrumentCdAndTp: key });
            lines = lines.concat(bars.map((b) => {
                return ohlc ? ['"' + moment.utc(b.time).format('YYYY-MM-DD HH:mm') + '"', b.open, b.high, b.low, b.close].join(',') : ['"' + moment.utc(b.time).format('YYYY-MM-DD HH:mm:ss') + '"', b.close].join(',');
            }));
        } else {
            lines[0] += ',"' + series.userOptions.name + '"'; //Add header
            dataToBeProcessTolines.push(newDataLines);
        }
    });

    notification.info(i18n('Downloading .csv'), `#${dialog_id}`);


    const filename = data.instrumentName + ' (' + data.timePeriod + ')' + '.csv';

    _.defer(() => {
       try {
          const csv = lines.map((line, index) => {
             dataToBeProcessTolines.forEach((dd) => {
                let added = false;
                dd.forEach((nDl) => {
                   if (nDl) {
                      const temp = nDl.split(',');
                      if (line.split(',')[0] === temp[0]) {
                         line += ',' + temp.slice(1, temp.length).join(',');
                         added = true;
                         return false;
                      }
                   }
                });
                if (line.indexOf('Date') == -1 && !added) line += ','; //Add a gap since we did not add a value
             });
             if (index === 0) {
                return line;
             }
             return line.split(" ").join("\",\""); //Separate date and time.
          }).join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          if (navigator.msSaveBlob) { // IE 10+
             navigator.msSaveBlob(blob, filename);
          }
          else {
             const link = document.createElement("a");
             if (link.download !== undefined) { /* Evergreen Browsers :) */
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
             }
          }
       }
       catch(e) {
          notification.error('Error downloading .csv', `#${dialog_id}`);
          console.error(e);
       }
    });
}

/**
 * This method is the core and the starting point of highstock charts drawing
 * @param containerIDWithHash
 * @param instrumentCode
 * @param instrumentName
 * @param timePeriod
 * @param type
 * @param onload // optional onload callback
 */
export const drawChart = (containerIDWithHash, options, onload) => {
    let indicators = [];
    let overlays = [];
    let current_symbol = [];

    liveapi.cached.send({active_symbols: "brief"}).then((data)=>{
        current_symbol = _.filter(data.active_symbols,{symbol: options.instrumentCode})[0];
    });

    if ($(containerIDWithHash).highcharts()) {
        //Just making sure that everything has been cleared out before starting a new thread
        const key = chartingRequestMap.keyFor(options.instrumentCode, options.timePeriod);
        chartingRequestMap.removeChart(key, containerIDWithHash);
        const chart = $(containerIDWithHash).highcharts();
        indicators = chart.get_indicators() || [];
        overlays = options.overlays || [];
        chart.destroy();
    }
    if (options.indicators) { /* this comes only from tracker.js & ChartTemplateManager.js */
        indicators = options.indicators || [];
        overlays = options.overlays || [];
        $(containerIDWithHash).data("overlayCount", overlays.length);
    }

    /* ignore overlays if chart type is candlestick or ohlc */
    if ((options.type === 'candlestick' || options.type === 'ohlc') && overlays.length > 0) {
        /* we should not come here, logging a warning as an alert if we somehow do */
        console.warn("Ingoring overlays because chart type is " + options.type);
        overlays = [];
    }

    //Save some data in DOM
    $(containerIDWithHash).data({
        instrumentCode: options.instrumentCode,
        instrumentName: options.instrumentName,
        timePeriod: options.timePeriod,
        type: options.type,
        delayAmount: options.delayAmount
    });

    // Create the chart
    $(containerIDWithHash).highcharts('StockChart', {

        chart: {
            events: {
                load: function(event) {

                    this.showLoading();
                    currentPrice.init();
                    liveapi.execute(() => {
                        ohlc_handler.retrieveChartDataAndRender({
                            timePeriod: options.timePeriod,
                            instrumentCode: options.instrumentCode,
                            containerIDWithHash: containerIDWithHash,
                            type: options.type,
                            instrumentName: options.instrumentName,
                            series_compare: options.series_compare,
                            delayAmount: options.delayAmount
                        }).catch((err) => {
                            const msg = i18n('Error getting data for %1').replace('%1', options.instrumentName);
                            notification.error(msg, containerIDWithHash.replace('_chart', ''));
                            const chart = $(containerIDWithHash).highcharts();
                            chart && chart.showLoading(msg);
                            console.error(err);
                        }).then(() => {
                            const chart = $(containerIDWithHash).highcharts();
                            /* the data is loaded but is not applied yet, its on the js event loop,
                               wait till the chart data is applied and then add the indicators */
                            setTimeout(() => {
                                chart && chart.set_indicators(indicators); // put back removed indicators
                                overlays.forEach((ovlay) => {
                                    overlay(containerIDWithHash, ovlay.symbol, ovlay.displaySymbol, ovlay.delay_amount);
                                });
                            }, 0);
                        });
                    });

                    if ($.isFunction(onload)) {
                        onload();
                    }

                    this.margin[2] = 5;
                    this.spacing[2] = 0;
                }
            },
            spacingLeft: 0,
            marginLeft: 55,
            /* disable the auto size labels so the Y axes become aligned */
            marginBottom: 15,
            spacingBottom: 15
        },

        navigator: {
            enabled: true,
            series: {
                id: 'navigator'
            }
        },

        plotOptions: {
            candlestick: {
                shadow: false
            },
            series: {
                events: {
                    afterAnimate: function() {
                        if (this.options.isInstrument && this.options.id !== "navigator") {
                            //this.isDirty = true;
                            //this.isDirtyData = true;

                            //Add current price indicator
                            //If we already added currentPriceLine for this series, ignore it
                            //console.log(this.options.id, this.yAxis.plotLinesAndBands);
                            this.removeCurrentPrice();
                            this.addCurrentPrice();

                            //Add mouse wheel zooming
                            // HMW.mousewheel(containerIDWithHash);
                        }

                        this.chart.hideLoading();
                        //this.chart.redraw();
                    }
                }
            }
        },

        title: {
            text: "" //name to display
        },

        credits: {
            href: '#',
            text: '',
        },

        xAxis: {
            events: {
                afterSetExtremes: function() {
                    /*console.log('This method is called every time the zoom control is changed. TODO.' +
                     'In future, I want to get more data from server if users is dragging the zoom control more.' +
                     'This will help to load data on chart forever! We can warn users if they are trying to load' +
                     'too much data!');*/
                }
            },
            labels: {
                formatter: function() {
                    const str = this.axis.defaultLabelFormatter.call(this);
                    return str.replace('.', '');
                }
            },
            ordinal: false
        },

        scrollbar: {
            liveRedraw: true
        },

        yAxis: [{
            opposite: false,
            labels: {
                reserveSpace: true,
                formatter: function() {
                    if(!current_symbol || !current_symbol.pip) return;
                    const digits_after_decimal = (current_symbol.pip+"").split(".")[1].length;
                    if ($(containerIDWithHash).data("overlayIndicator")) {
                        return (this.value > 0 ? ' + ' : '') + this.value + '%';
                    } 
                    return this.value.toFixed(digits_after_decimal);
                },
                align: 'center'
            }
        }],

        rangeSelector: {
            enabled: false
        },

        tooltip: {
            crosshairs: [{
                width: 2,
                color: 'red',
                dashStyle: 'dash'
            }, {
                width: 2,
                color: 'red',
                dashStyle: 'dash'
            }],
            formatter: function() {
               // TODO: fix moment locale
                // moment.locale(lang); //Setting locale
                var s = "<i>" + moment.utc(this.x).format("dddd, DD MMM YYYY, HH:mm:ss") + "</i><br>";
                $.each(this.points, function(i){
                    s += '<span style="color:' + this.point.color + '">\u25CF </span>';
                    if(typeof this.point.open !=="undefined") { //OHLC chart
                        s += "<b>" + this.series.name + "</b>"
                        s += `<br>  ${i18n('Open')}: ` + this.point.open;
                        s += `<br>  ${i18n('High')}: ` + this.point.high;
                        s += `<br>  ${i18n('Low')}: ` + this.point.low;
                        s += `<br>  ${i18n('Close')}: ` + this.point.close;
                    } else {
                        s += this.series.name + ": <b>" + this.point.y + "</b>";
                    }
                    s += "<br>";
                })
                return s;
            },
            enabled: true,
            enabledIndicators: true
        },

        exporting: {
            enabled: false,
            url: 'https://export.highcharts.com',
            // Naming the File
            filename: options.instrumentName.split(' ').join('_') + "(" + options.timePeriod + ")"
        }

    });
}

export const triggerReflow = (containerIDWithHash) => {
    if ($(containerIDWithHash).highcharts()) {
        $(containerIDWithHash).highcharts().reflow();
    }
}

export const refresh = function(containerIDWithHash, newTimePeriod, newChartType, indicators, overlays) {
    const instrumentCode = $(containerIDWithHash).data("instrumentCode");
    if (newTimePeriod) {
        //Unsubscribe from tickstream.
        const key = chartingRequestMap.keyFor(instrumentCode, $(containerIDWithHash).data("timePeriod"));
        chartingRequestMap.unregister(key, containerIDWithHash);
        $(containerIDWithHash).data("timePeriod", newTimePeriod);
    }
    if (newChartType) $(containerIDWithHash).data("type", newChartType);
    else newChartType = $(containerIDWithHash).data("type", newChartType);

    //Get all series details from this chart
    const chart = $(containerIDWithHash).highcharts();
    let loadedMarketData = [],
        series_compare = undefined;
    /* for ohlc and candlestick series_compare must NOT be percent */
    if (newChartType !== 'ohlc' && newChartType !== 'candlestick') {
        $(chart.series).each((index, series) => {
            if (series.userOptions.isInstrument) {
                loadedMarketData.push(series.name);
                //There could be one valid series_compare value per chart
                series_compare = series.userOptions.compare;
            }
        });
    }
    let overlaysReadyPromise = Promise.resolve();
    if (!overlays) {
        overlays = [];
        overlaysReadyPromise = marketData().then((markets) => {
           loadedMarketData.forEach((value) => {
               const marketDataObj = specificMarketDataSync(value, markets);
               if (marketDataObj.symbol != undefined && $.trim(marketDataObj.symbol) != $(containerIDWithHash).data("instrumentCode")) {
                   const overlay = {
                       symbol: marketDataObj.symbol,
                       displaySymbol: value,
                       delay_amount: marketDataObj.delay_amount
                   };
                   overlays.push(overlay);
               }
           });
        });
    }
   overlaysReadyPromise.then(() => {
      drawChart(containerIDWithHash, {
         instrumentCode: instrumentCode,
         instrumentName: $(containerIDWithHash).data("instrumentName"),
         timePeriod: $(containerIDWithHash).data("timePeriod"),
         type: $(containerIDWithHash).data("type"),
         series_compare: series_compare,
         delayAmount: $(containerIDWithHash).data("delayAmount"),
         overlays: overlays,
         indicators: indicators
      });
   });
}

export const addIndicator = (containerIDWithHash, options) => {
    if ($(containerIDWithHash).highcharts()) {
        const chart = $(containerIDWithHash).highcharts();
        const series = chart.series[0];
        if (series) {
            chart.addIndicator($.extend({
                id: series.options.id
            }, options));
        }
    }
}

/**
 * Function to overlay instrument on base chart
 * @param containerIDWithHash
 * @param overlayInsCode
 * @param overlayInsName
 */
export const overlay = (containerIDWithHash, overlayInsCode, overlayInsName, delayAmount) => {
    if ($(containerIDWithHash).highcharts()) {
        const chart = $(containerIDWithHash).highcharts();
        const indicator_series = chart.get_indicator_series();
        //const mainSeries_instCode     = $(containerIDWithHash).data("instrumentCode");
        //const mainSeries_instName     = $(containerIDWithHash).data("instrumentName");
        /*
            We have to first set the data to NULL and then recaculate the data and set it back
            This is needed, else highstocks throws error
         */
        const mainSeries_timePeriod = $(containerIDWithHash).data("timePeriod");
        const mainSeries_type = $(containerIDWithHash).data("type");
        chart.showLoading();
        for (let index = 0; index < chart.series.length; index++) {
            const series = chart.series[index];
            if ((series.userOptions.isInstrument || series.userOptions.onChartIndicator) && series.userOptions.id !== 'navigator') {
                series.update({
                    compare: 'percent'
                });
            }
        }

        return new Promise((resolve, reject) => {
            liveapi.execute(() => {
                ohlc_handler.retrieveChartDataAndRender({
                    timePeriod: mainSeries_timePeriod,
                    instrumentCode: overlayInsCode,
                    containerIDWithHash: containerIDWithHash,
                    type: mainSeries_type,
                    instrumentName: overlayInsName,
                    series_compare: 'percent',
                    delayAmount: delayAmount
                }).then(() => {
                    chart && chart.set_indicator_series(indicator_series);
                    if(chart.series[0].data.length ===0){
                        console.trace();
                    }
                    resolve();
                }).catch((e) => {
                   console.error(e);
                   resolve();
                });
            });
        });
    }
    return Promise.resolve();
}

export const changeTitle = (containerIDWithHash, newTitle) => {
    const chart = $(containerIDWithHash).highcharts();
    chart.setTitle(newTitle);
}

export default {
    drawChart,
    destroy,
    triggerReflow,
    generate_csv,
    refresh,
    addIndicator,
    overlay,
    changeTitle
}